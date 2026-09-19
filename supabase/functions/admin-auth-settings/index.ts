// deno-lint-ignore-file no-explicit-any
/**
 * admin-auth-settings Edge Function — auth & human-verification configuration.
 *
 * Actions:
 *  - save { client_id, client_secret }        — GitHub OAuth credentials (+ enable)
 *  - clear                                    — disable GitHub OAuth
 *  - save_firebase { firebase config fields } — Google sign-in via Firebase:
 *      stores the PUBLIC web config in app_settings (the SPA reads it) and
 *      enables Supabase third-party auth for the Firebase project.
 *  - save_turnstile { site_key, secret_key }  — Cloudflare Turnstile:
 *      site key is public (app_settings); the secret is AES-GCM encrypted
 *      into private_settings and applied to the Supabase auth captcha config.
 *  - status — everything the admin settings page needs (secrets masked)
 *
 * Requires env: MGMT_API_TOKEN, NEXOR_ENCRYPTION_KEY.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-kashier-signature',
	'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
};

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
	});
}

function b64ToBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bytes.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
}

function bytesToB64(bytes: Uint8Array): string {
	let bin = '';
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
	return btoa(bin);
}

async function encrypt(plaintext: string, dekB64: string): Promise<string> {
	const raw = b64ToBytes(dekB64);
	const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt']);
	const nonce = crypto.getRandomValues(new Uint8Array(12));
	const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, new TextEncoder().encode(plaintext));
	return bytesToB64(new Uint8Array([...nonce, ...new Uint8Array(ct)]));
}

async function decrypt(stored: string, dekB64: string): Promise<string> {
	const bytes = b64ToBytes(stored);
	const nonce = bytes.slice(0, 12), ct = bytes.slice(12);
	const raw = b64ToBytes(dekB64);
	const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
	return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ct));
}

async function patchAuthConfig(mgmtToken: string, cfgUrl: string, patch: Record<string, unknown>): Promise<Response> {
	return await fetch(cfgUrl, {
		method: 'PATCH',
		headers: { Authorization: `Bearer ${mgmtToken}`, 'Content-Type': 'application/json' },
		body: JSON.stringify(patch),
	});
}

Deno.serve(async (req) => {
	if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
	if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

	const authHeader = req.headers.get('Authorization') ?? '';
	const supabase = createClient(
		Deno.env.get('SUPABASE_URL')!,
		Deno.env.get('SUPABASE_ANON_KEY')!,
		{ global: { headers: { Authorization: authHeader } } },
	);
	const { data: { user } } = await supabase.auth.getUser();
	if (!user) return json({ error: 'unauthorized' }, 401);

	const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
	const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).single();
	if (profile?.role !== 'admin') return json({ error: 'forbidden' }, 403);

	const mgmtToken = Deno.env.get('MGMT_API_TOKEN');
	if (!mgmtToken) return json({ error: 'MGMT_API_TOKEN not configured on the function' }, 500);
	const projectRef = new URL(Deno.env.get('SUPABASE_URL')!).hostname.split('.')[0];
	const cfgUrl = `https://api.supabase.com/v1/projects/${projectRef}/config/auth`;

	let body: Record<string, any>;
	try {
		body = await req.json();
	} catch {
		return json({ error: 'invalid json' }, 400);
	}

	try {
		// ---------- GitHub OAuth (unchanged behavior) ----------
		if (body.action === 'save') {
			const clientId = String(body.client_id ?? '').trim();
			const clientSecret = String(body.client_secret ?? '').trim();
			if (!clientId || !clientSecret) return json({ error: 'client_id and client_secret required' }, 400);

			const res = await patchAuthConfig(mgmtToken, cfgUrl, {
				external_github_enabled: true,
				external_github_client_id: clientId,
				external_github_secret: clientSecret,
			});
			if (!res.ok) {
				const detail = await res.text();
				return json({ error: `management api ${res.status}: ${detail.slice(0, 300)}` }, 502);
			}
			return json({ ok: true, enabled: true, client_id: clientId, has_secret: true });
		}

		if (body.action === 'clear') {
			const res = await patchAuthConfig(mgmtToken, cfgUrl, {
				external_github_enabled: false,
				external_github_client_id: '',
				external_github_secret: '',
			});
			if (!res.ok) return json({ error: `management api ${res.status}` }, 502);
			return json({ ok: true, enabled: false, client_id: '', has_secret: false });
		}

		// ---------- Google sign-in via Firebase ----------
		if (body.action === 'save_firebase') {
			const cfg = {
				apiKey: String(body.api_key ?? '').trim(),
				authDomain: String(body.auth_domain ?? '').trim(),
				projectId: String(body.project_id ?? '').trim(),
				storageBucket: String(body.storage_bucket ?? '').trim() || undefined,
				messagingSenderId: String(body.messaging_sender_id ?? '').trim() || undefined,
				appId: String(body.app_id ?? '').trim(),
			};
			if (!cfg.apiKey || !cfg.projectId || !cfg.appId) {
				return json({ error: 'api_key, project_id and app_id are required' }, 400);
			}

			// public config → app_settings (the SPA renders the button from this)
			const { error: updErr } = await admin.from('app_settings').update({
				google_auth_enabled: body.enabled !== false,
				firebase_config: cfg,
			}).eq('id', 1);
			if (updErr) return json({ error: updErr.message }, 500);

			// tell Supabase auth to accept this Firebase project's ID tokens
			const res = await patchAuthConfig(mgmtToken, cfgUrl, {
				third_party_firebase_enabled: body.enabled !== false,
				third_party_firebase_project_id: cfg.projectId,
			});
			if (!res.ok) {
				const detail = await res.text();
				return json({ error: `management api ${res.status}: ${detail.slice(0, 300)}` }, 502);
			}
			return json({ ok: true, google_auth_enabled: body.enabled !== false, project_id: cfg.projectId });
		}

		if (body.action === 'clear_firebase') {
			const { error: updErr } = await admin.from('app_settings').update({
				google_auth_enabled: false,
				firebase_config: {},
			}).eq('id', 1);
			if (updErr) return json({ error: updErr.message }, 500);
			await patchAuthConfig(mgmtToken, cfgUrl, { third_party_firebase_enabled: false });
			return json({ ok: true, google_auth_enabled: false });
		}

		// ---------- Cloudflare Turnstile ----------
		if (body.action === 'save_turnstile') {
			const siteKey = String(body.site_key ?? '').trim();
			const secretKey = String(body.secret_key ?? '').trim();
			if (!siteKey || !secretKey) return json({ error: 'site_key and secret_key required' }, 400);

			const dek = Deno.env.get('NEXOR_ENCRYPTION_KEY')!;
			const encrypted = await encrypt(secretKey, dek);
			const { error: privErr } = await admin.from('private_settings').upsert({
				key: 'turnstile_secret',
				value_encrypted: encrypted,
			});
			if (privErr) return json({ error: privErr.message }, 500);

			const { error: updErr } = await admin.from('app_settings').update({
				turnstile_enabled: body.enabled !== false,
				turnstile_site_key: siteKey,
				turnstile_on_login: body.on_login !== false,
				turnstile_on_api_key: body.on_api_key === true,
			}).eq('id', 1);
			if (updErr) return json({ error: updErr.message }, 500);

			// protect Supabase auth endpoints (login/signup) with the same widget
			const res = await patchAuthConfig(mgmtToken, cfgUrl, {
				captcha_enabled: body.enabled !== false,
				captcha_provider: 'cloudflare_turnstile',
				captcha_secret: secretKey,
			});
			if (!res.ok) {
				const detail = await res.text();
				return json({ error: `management api ${res.status}: ${detail.slice(0, 300)}` }, 502);
			}
			return json({ ok: true, site_key: siteKey });
		}

		if (body.action === 'clear_turnstile') {
			const { error: updErr } = await admin.from('app_settings').update({
				turnstile_enabled: false,
				turnstile_site_key: '',
			}).eq('id', 1);
			if (updErr) return json({ error: updErr.message }, 500);
			await admin.from('private_settings').delete().eq('key', 'turnstile_secret');
			await patchAuthConfig(mgmtToken, cfgUrl, { captcha_enabled: false });
			return json({ ok: true, enabled: false });
		}

		// ---------- status ----------
		const res = await fetch(cfgUrl, { headers: { Authorization: `Bearer ${mgmtToken}` } });
		if (!res.ok) return json({ error: `management api ${res.status}` }, 502);
		const cfg = await res.json();
		const { data: settings } = await admin.from('app_settings')
			.select('signup_mode, google_auth_enabled, firebase_config, turnstile_enabled, turnstile_site_key, turnstile_on_login, turnstile_on_api_key')
			.eq('id', 1).maybeSingle();
		return json({
			github: {
				enabled: !!cfg.external_github_enabled,
				client_id: cfg.external_github_client_id ?? '',
				has_secret: !!cfg.external_github_secret,
			},
			google: {
				enabled: !!settings?.google_auth_enabled,
				firebase_config: settings?.firebase_config ?? {},
				third_party_enabled: !!cfg.third_party_firebase_enabled,
			},
			turnstile: {
				enabled: !!settings?.turnstile_enabled,
				site_key: settings?.turnstile_site_key ?? '',
				on_login: settings?.turnstile_on_login ?? true,
				on_api_key: settings?.turnstile_on_api_key ?? false,
			},
			signup_mode: settings?.signup_mode ?? 'email_and_github',
			site_url: cfg.site_url ?? '',
		});
	} catch (err) {
		return json({ error: err instanceof Error ? err.message : String(err) }, 500);
	}
});
