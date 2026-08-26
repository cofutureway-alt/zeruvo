// deno-lint-ignore-file no-explicit-any
/**
 * admin-sync-models — pulls the upstream provider /models catalog into our
 * models table (disabled by default). Admin-only. Decrypts the provider's
 * first live key server-side to call the upstream API.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

function b64ToBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
}

async function decrypt(stored: string, dekB64: string): Promise<string> {
	const bytes = b64ToBytes(stored);
	const nonce = bytes.slice(0, 12);
	const ciphertext = bytes.slice(12);
	const raw = b64ToBytes(dekB64);
	const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
	const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext);
	return new TextDecoder().decode(plain);
}

Deno.serve(async (req) => {
	if (req.method !== 'POST') {
		return Response.json({ error: 'method not allowed' }, { status: 405 });
	}
	const authHeader = req.headers.get('Authorization') ?? '';
	const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
		global: { headers: { Authorization: authHeader } },
	});
	const { data: { user } } = await supabase.auth.getUser();
	if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

	const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
	const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).single();
	if (profile?.role !== 'admin') return Response.json({ error: 'forbidden' }, { status: 403 });

	const { provider_id } = await req.json().catch(() => ({ provider_id: null }));
	if (!provider_id) return Response.json({ error: 'provider_id required' }, { status: 400 });

	const { data: provider } = await admin.from('providers').select('*').eq('id', provider_id).single();
	if (!provider) return Response.json({ error: 'provider not found' }, { status: 404 });

	const { data: keys } = await admin
		.from('provider_keys')
		.select('encrypted_key,dead_until,label')
		.eq('provider_id', provider_id);
	const liveKey = (keys ?? []).find((k) => !k.dead_until || new Date(k.dead_until) <= new Date());
	if (!liveKey) return Response.json({ error: 'no live keys' }, { status: 403 });

	let apiKey: string;
	try {
		apiKey = await decrypt(liveKey.encrypted_key, Deno.env.get('NEXOR_ENCRYPTION_KEY')!);
	} catch {
		return Response.json({ error: 'key decrypt failed' }, { status: 500 });
	}

	const base = String(provider.base_url).replace(/\/+$/, '');
	const res = await fetch(`${base}/models`, {
		headers:
			provider.kind === 'openrouter'
				? { Authorization: `Bearer ${apiKey}`, 'HTTP-Referer': 'https://nexor.ai' }
				: { Authorization: `Bearer ${apiKey}` },
	});
	if (!res.ok) return Response.json({ error: `upstream ${res.status}` }, { status: 502 });
	const json = await res.json();
	const upstreamIds: string[] = (json.data ?? []).map((m: { id: string }) => m.id);

	const { data: existing } = await admin
		.from('models')
		.select('upstream_model_id')
		.eq('provider_id', provider_id);
	const known = new Set((existing ?? []).map((m) => m.upstream_model_id));

	const toInsert = upstreamIds
		.filter((id) => !known.has(id))
		.map((id) => ({
			provider_id,
			upstream_model_id: id,
			display_name: id,
			slug: id.replace(/[^a-zA-Z0-9._:-]/g, '-').replace(/^-+/, ''),
			usage_multiplier: 1,
			enabled_for_users: false,
		}));
	if (toInsert.length) {
		await admin.from('models').insert(toInsert);
	}

	return Response.json({ synced: upstreamIds.length, added: toInsert.length });
});
