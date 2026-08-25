/**
 * Full success path: register mock provider + AES-GCM encrypted key,
 * then call the DEPLOYED gateway end-to-end (streaming + non-streaming),
 * verifying quota settlement in the database.
 */
import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf8');
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)[1].trim();
const svc = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim();
const dekB64 = env.match(/NEXOR_ENCRYPTION_KEY=(.+)/)[1].trim();
const GW = 'https://nexor-gateway.alammmedd4.workers.dev';
const H = { apikey: svc, Authorization: `Bearer ${svc}`, 'Content-Type': 'application/json' };

const b64 = (bytes) => Buffer.from(bytes).toString('base64');

async function encryptKey(plaintext) {
	const raw = Buffer.from(dekB64, 'base64');
	const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt']);
	const nonce = crypto.getRandomValues(new Uint8Array(12));
	const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, new TextEncoder().encode(plaintext));
	return b64(Buffer.concat([Buffer.from(nonce), Buffer.from(ct)]));
}

(async () => {
	// 1) provider pointing at the deployed mock
	const provRes = await fetch(`${url}/rest/v1/providers`, {
		method: 'POST',
		headers: { ...H, Prefer: 'return=representation' },
		body: JSON.stringify({
			kind: 'custom',
			display_name: 'MockProvider',
			base_url: 'https://nexor-mock-llm.alammmedd4.workers.dev/v1',
		}),
	});
	const providerId = (await provRes.json())[0].id;

	// 2) its "API key" (mock ignores it, but exercises encrypt/decrypt path)
	const enc = await encryptKey('mock-secret-key-12345');
	await fetch(`${url}/rest/v1/provider_keys`, {
		method: 'POST', headers: H,
		body: JSON.stringify({ provider_id: providerId, label: 'mock-1', encrypted_key: enc, weight: 1 }),
	});
	console.log('provider+key registered:', providerId);

	// 3) model bound to it, multiplier 2.5
	const slug = 'mock-model-' + Date.now();
	const modelRes = await fetch(`${url}/rest/v1/models`, {
		method: 'POST',
		headers: { ...H, Prefer: 'return=representation' },
		body: JSON.stringify({
			provider_id: providerId,
			upstream_model_id: slug,
			display_name: 'Mock Model',
			usage_multiplier: 2.5,
			enabled_for_users: true,
			slug,
			context_window: 8192,
		}),
	});
	console.log('model created:', (await modelRes.json())[0]?.id);

	// 4) user + api key
	const email = `full-${Date.now()}@nexor.dev`;
	const uid = (
		await (
			await fetch(`${url}/auth/v1/admin/users`, {
				method: 'POST', headers: H,
				body: JSON.stringify({ email, password: 'Demo1234!pass', email_confirm: true }),
			})
		).json()
	).id;
	const rawKey = 'sk-nexor-' + crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
	const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawKey));
	const hash = [...new Uint8Array(hashBuf)].map((b) => b.toString(16).padStart(2, '0')).join('');
	await fetch(`${url}/rest/v1/user_api_keys`, {
		method: 'POST', headers: H,
		body: JSON.stringify({ user_id: uid, name: 'e2e', prefix: rawKey.slice(0, 12), last4: rawKey.slice(-4), sha256_hash: hash }),
	});

	// 5a) NON-STREAMING completion through the gateway
	let r = await fetch(GW + '/v1/chat/completions', {
		method: 'POST',
		headers: { Authorization: `Bearer ${rawKey}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ model: slug, messages: [{ role: 'user', content: 'hello' }] }),
	});
	const nonStream = await r.json();
	console.log('non-stream:', r.status, '| content:', nonStream.choices?.[0]?.message?.content);
	console.log('usage returned:', JSON.stringify(nonStream.usage));

	// wait for async settle
	await new Promise((res) => setTimeout(res, 2500));

	// 5b) STREAMING completion through the gateway
	r = await fetch(GW + '/v1/chat/completions', {
		method: 'POST',
		headers: { Authorization: `Bearer ${rawKey}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ model: slug, messages: [{ role: 'user', content: 'hi again' }], stream: true }),
	});
	const text = await r.text();
	console.log('stream:', r.status, '| frames contain [DONE]:', text.includes('[DONE]'), '| has chunks:', text.includes('Mock'));

	await new Promise((res) => setTimeout(res, 2500));

	// 6) verify settlement: consumed should be (12+7)*2.5*2 calls ≈ 95 weighted
	const du = await fetch(`${url}/rest/v1/daily_usage?user_id=eq.${uid}&select=*`, { headers: H });
	console.log('daily_usage after both calls:', JSON.stringify(await du.json()));

	const logs = await fetch(`${url}/rest/v1/request_logs?user_id=eq.${uid}&select=tokens_in,tokens_out,weighted_tokens,status&order=created_at.desc`, { headers: H });
	console.log('request_logs:', JSON.stringify(await logs.json()));

	// cleanup
	await fetch(`${url}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: H });
})();
