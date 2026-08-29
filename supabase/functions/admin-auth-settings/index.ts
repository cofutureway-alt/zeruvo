// deno-lint-ignore-file no-explicit-any
/**
 * admin-auth-settings Edge Function — stores the GitHub OAuth credentials
 * (Client ID + Client Secret) and toggles the GitHub provider on the
 * Supabase auth config via the Management API.
 *
 * Secrets never touch the database — they are applied straight to the
 * project's auth config, and only the admin can call this function.
 *
 * Actions:
 *  - save { client_id, client_secret } — set credentials (+ enable provider)
 *  - status — returns { enabled, client_id, has_secret } (secret masked)
 *  - clear — removes credentials and disables the provider
 *
 * Requires env: MGMT_API_TOKEN (Management API token with auth
 * config write access on this project).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-kashier-signature',
};

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
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

	let body: { action?: string; client_id?: string; client_secret?: string };
	try {
		body = await req.json();
	} catch {
		return json({ error: 'invalid json' }, 400);
	}

	try {
		if (body.action === 'save') {
			const clientId = String(body.client_id ?? '').trim();
			const clientSecret = String(body.client_secret ?? '').trim();
			if (!clientId || !clientSecret) return json({ error: 'client_id and client_secret required' }, 400);

			const res = await fetch(cfgUrl, {
				method: 'PATCH',
				headers: { Authorization: `Bearer ${mgmtToken}`, 'Content-Type': 'application/json' },
				body: JSON.stringify({
					external_github_enabled: true,
					external_github_client_id: clientId,
					external_github_secret: clientSecret,
				}),
			});
			if (!res.ok) {
				const detail = await res.text();
				return json({ error: `management api ${res.status}: ${detail.slice(0, 300)}` }, 502);
			}
			return json({ ok: true, enabled: true, client_id: clientId, has_secret: true });
		}

		if (body.action === 'clear') {
			const res = await fetch(cfgUrl, {
				method: 'PATCH',
				headers: { Authorization: `Bearer ${mgmtToken}`, 'Content-Type': 'application/json' },
				body: JSON.stringify({
					external_github_enabled: false,
					external_github_client_id: '',
					external_github_secret: '',
				}),
			});
			if (!res.ok) return json({ error: `management api ${res.status}` }, 502);
			return json({ ok: true, enabled: false, client_id: '', has_secret: false });
		}

		// default: status
		const res = await fetch(cfgUrl, { headers: { Authorization: `Bearer ${mgmtToken}` } });
		if (!res.ok) return json({ error: `management api ${res.status}` }, 502);
		const cfg = await res.json();
		return json({
			enabled: !!cfg.external_github_enabled,
			client_id: cfg.external_github_client_id ?? '',
			has_secret: !!cfg.external_github_secret,
			site_url: cfg.site_url ?? '',
		});
	} catch (err) {
		return json({ error: err instanceof Error ? err.message : String(err) }, 500);
	}
});
