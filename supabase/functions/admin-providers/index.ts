// deno-lint-ignore-file no-explicit-any
/**
 * admin-providers — provider & key management for the admin console.
 * Admin-only. Secrets are encrypted with the AES-GCM DEK server-side.
 *
 * Actions:
 *   create_provider  { kind, display_name, base_url }
 *   update_provider  { provider_id, display_name?, base_url?, status? }
 *   delete_provider  { provider_id }         (cascades keys+models)
 *   add_key          { provider_id, api_key, weight? }
 *   delete_key       { key_id }
 *   set_key_weight   { key_id, weight }
 *   test_key         { key_id }   -> live upstream /models probe
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const enc = new TextEncoder();
function b64(bytes: Uint8Array): string {
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin);
}
async function encryptKey(plaintext: string, dekB64: string): Promise<string> {
	const raw = Uint8Array.from(atob(dekB64), (c) => c.charCodeAt(0));
	const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt']);
	const nonce = crypto.getRandomValues(new Uint8Array(12));
	const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, enc.encode(plaintext));
	const merged = new Uint8Array(nonce.length + ct.byteLength);
	merged.set(nonce); merged.set(new Uint8Array(ct), nonce.length);
	return b64(merged);
}
async function decryptKey(stored: string, dekB64: string): Promise<string> {
	const bytes = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
	const nonce = bytes.slice(0, 12), ct = bytes.slice(12);
	const raw = Uint8Array.from(atob(dekB64), (c) => c.charCodeAt(0));
	const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
	return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ct));
}

Deno.serve(async (req) => {
// CORS: the SPA calls these functions directly from the browser
const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-kashier-signature',
};

if (req.method === 'OPTIONS') {
	return new Response('ok', { headers: CORS_HEADERS });
}

	if (req.method !== 'POST') return Response.json({ error: 'method not allowed' }, { status: 405, headers: CORS_HEADERS })

	const authHeader = req.headers.get('Authorization') ?? '';
	const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
		global: { headers: { Authorization: authHeader } },
	});
	const { data: { user } } = await supabase.auth.getUser();
	if (!user) return Response.json({ error: 'unauthorized' }, { status: 401, headers: CORS_HEADERS })

	const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
	const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).single();
	if (profile?.role !== 'admin') return Response.json({ error: 'forbidden' }, { status: 403, headers: CORS_HEADERS })

	let body: Record<string, any>;
	try { body = await req.json(); } catch { return Response.json({ error: 'invalid json' }, { status: 400, headers: CORS_HEADERS }) }
	const action = body.action as string;

	async function audit(actionName: string, targetId: string, diff: unknown) {
		await admin.from('audit_logs').insert({
			admin_id: user!.id, action: `admin_providers.${actionName}`,
			target_table: 'providers', target_id: targetId, diff: diff as any,
		});
	}

	try {
		switch (action) {
			case 'create_provider': {
				const base = body.kind === 'openrouter'
					? 'https://openrouter.ai/api/v1'
					: String(body.base_url ?? '').replace(/\/+$/, '');
				if (!body.display_name || !base) return Response.json({ error: 'display_name + base_url required' }, { status: 400, headers: CORS_HEADERS })
				const { data, error } = await admin.from('providers')
					.insert({ kind: body.kind, display_name: body.display_name, base_url: base })
					.select().single();
				if (error) return Response.json({ error: error.message }, { status: 500, headers: CORS_HEADERS })
				await audit('create_provider', data.id, body);
				return Response.json({ provider: data }, { headers: CORS_HEADERS })
			}
			case 'update_provider': {
				const upd: Record<string, unknown> = {};
				if (body.display_name != null) upd.display_name = body.display_name;
				if (body.base_url != null) upd.base_url = String(body.base_url).replace(/\/+$/, '');
				if (body.status != null) upd.status = body.status;
				const { data, error } = await admin.from('providers')
					.update(upd).eq('id', body.provider_id).select().single();
				if (error) return Response.json({ error: error.message }, { status: 500, headers: CORS_HEADERS })
				await audit('update_provider', body.provider_id, upd);
				return Response.json({ provider: data }, { headers: CORS_HEADERS })
			}
			case 'delete_provider': {
				// models cascade via FK; keys cascade too
				const { error } = await admin.from('providers').delete().eq('id', body.provider_id);
				if (error) return Response.json({ error: error.message }, { status: 500, headers: CORS_HEADERS })
				await audit('delete_provider', body.provider_id, null);
				return Response.json({ ok: true }, { headers: CORS_HEADERS })
			}
			case 'add_key': {
				if (!body.api_key?.trim()) return Response.json({ error: 'api_key required' }, { status: 400, headers: CORS_HEADERS })
				const encrypted = await encryptKey(body.api_key.trim(), Deno.env.get('NEXOR_ENCRYPTION_KEY')!);
				const { data, error } = await admin.from('provider_keys')
					.insert({
						provider_id: body.provider_id,
						label: body.label ?? `key-${Date.now().toString(36)}`,
						encrypted_key: encrypted,
						weight: Number(body.weight ?? 1),
					})
					.select('id,provider_id,label,weight,dead_until,last_error_code,created_at').single();
				if (error) return Response.json({ error: error.message }, { status: 500, headers: CORS_HEADERS })
				await audit('add_key', data.id, { provider_id: body.provider_id });
				return Response.json({ key: data }, { headers: CORS_HEADERS })
			}
			case 'delete_key': {
				const { error } = await admin.from('provider_keys').delete().eq('id', body.key_id);
				if (error) return Response.json({ error: error.message }, { status: 500, headers: CORS_HEADERS })
				await audit('delete_key', body.key_id, null);
				return Response.json({ ok: true }, { headers: CORS_HEADERS })
			}
			case 'set_key_weight': {
				const w = Number(body.weight);
				if (!(w > 0)) return Response.json({ error: 'weight must be > 0' }, { status: 400, headers: CORS_HEADERS })
				const { error } = await admin.from('provider_keys').update({ weight: w }).eq('id', body.key_id);
				if (error) return Response.json({ error: error.message }, { status: 500, headers: CORS_HEADERS })
				await audit('set_key_weight', body.key_id, { weight: w });
				return Response.json({ ok: true }, { headers: CORS_HEADERS })
			}
			case 'test_key': {
				const { data: row } = await admin.from('provider_keys')
					.select('id,provider_id,encrypted_key').eq('id', body.key_id).single();
				if (!row) return Response.json({ error: 'key not found' }, { status: 404, headers: CORS_HEADERS })
				const { data: provider } = await admin.from('providers')
					.select('kind,base_url,status').eq('id', row.provider_id).single();

				const apiKey = await decryptKey(row.encrypted_key, Deno.env.get('NEXOR_ENCRYPTION_KEY')!);
				const base = String(provider.base_url).replace(/\/+$/, '');
				const headers: Record<string, string> =
					provider.kind === 'openrouter'
						? { Authorization: `Bearer ${apiKey}`, 'HTTP-Referer': 'https://nexor.ai' }
						: { Authorization: `Bearer ${apiKey}` };

				const t0 = Date.now();
				const res = await fetch(`${base}/models`, { headers });
				const latency = Date.now() - t0;

				let modelCount = 0;
				let detail = res.ok ? 'ok' : `HTTP ${res.status}`;
				if (res.ok) {
					try {
						const j = await res.json();
						modelCount = Array.isArray(j.data) ? j.data.length : 0;
					} catch { /* non-json ok */ }
					// clear dead marker on success
					await admin.from('provider_keys').update({ dead_until: null, last_error_code: null }).eq('id', row.id);
				} else if ([401, 402, 403].includes(res.status)) {
					await admin.from('provider_keys').update({
						dead_until: new Date(Date.now() + 30 * 60_000).toISOString(),
						last_error_code: res.status,
					}).eq('id', row.id);
				}
				await audit('test_key', row.id, { status: res.status });
				return Response.json({ ok: res.ok, status: res.status, latency_ms: latency, model_count: modelCount, detail }, { headers: CORS_HEADERS })
			}
			default:
				return Response.json({ error: `unknown action ${action}` }, { status: 400, headers: CORS_HEADERS })
		}
	} catch (err) {
		console.error(err);
		return Response.json({ error: 'internal error' }, { status: 500, headers: CORS_HEADERS })
	}
});
