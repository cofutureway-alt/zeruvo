// deno-lint-ignore-file no-explicit-any
/**
 * admin-crypto Edge Function — encrypts provider/payment-gateway secrets
 * with the AES-256-GCM DEK (server-side secret), same envelope the gateway
 * Worker decrypts: base64(nonce(12) || ciphertext).
 *
 * Auth: caller must hold an admin profile (checked against profiles.role).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const encoder = new TextEncoder();

function b64encode(bytes: Uint8Array): string {
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin);
}

async function encrypt(plaintext: string, dekB64: string): Promise<string> {
	const raw = Uint8Array.from(atob(dekB64), (c) => c.charCodeAt(0));
	const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt']);
	const nonce = crypto.getRandomValues(new Uint8Array(12));
	const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, encoder.encode(plaintext));
	const merged = new Uint8Array(nonce.length + ct.byteLength);
	merged.set(nonce);
	merged.set(new Uint8Array(ct), nonce.length);
	return b64encode(merged);
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

	if (req.method !== 'POST') {
		return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405 });
	}

	const authHeader = req.headers.get('Authorization') ?? '';
	const supabase = createClient(
		Deno.env.get('SUPABASE_URL')!,
		Deno.env.get('SUPABASE_ANON_KEY')!,
		{ global: { headers: { Authorization: authHeader } } },
	);

	const { data: { user } } = await supabase.auth.getUser();
	if (!user) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });

	// role check via service client
	const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
	const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).single();
	if (profile?.role !== 'admin') {
		return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 });
	}

	let body: { values?: string[] };
	try {
		body = await req.json();
	} catch {
		return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400 });
	}
	if (!Array.isArray(body.values)) {
		return new Response(JSON.stringify({ error: 'values[] required' }), { status: 400 });
	}

	const dek = Deno.env.get('NEXOR_ENCRYPTION_KEY');
	if (!dek) return new Response(JSON.stringify({ error: 'DEK not configured' }), { status: 500 });

	const encrypted: string[] = [];
	for (const v of body.values.slice(0, 20)) {
		encrypted.push(await encrypt(String(v), dek));
	}
	return new Response(JSON.stringify({ encrypted }), { headers: { 'Content-Type': 'application/json' } });
});
