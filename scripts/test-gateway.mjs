/**
 * Gateway E2E test — runs against the DEPLOYED worker + hosted DB.
 * Creates a real user + real API key, then probes every guard rail
 * and (if a provider key exists) a live chat completion.
 */
import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf8');
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)[1].trim();
const svc = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim();
const GW = 'https://nexor-gateway.alammmedd4.workers.dev';
const H = { apikey: svc, Authorization: `Bearer ${svc}`, 'Content-Type': 'application/json' };

async function rpc(fn, body) {
	const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
		method: 'POST', headers: H, body: JSON.stringify(body),
	});
	const t = await r.text();
	return { status: r.status, json: t ? JSON.parse(t) : null };
}

(async () => {
	// 0) seed an enabled model bound to a provider
	const provRes = await fetch(`${url}/rest/v1/providers`, {
		method: 'POST',
		headers: { ...H, Prefer: 'return=representation' },
		body: JSON.stringify({ kind: 'custom', display_name: 'TestProvider', base_url: 'https://example.invalid/v1' }),
	});
	let providerId = (await provRes.json())[0]?.id;
	if (!providerId) {
		// already exists from previous run — fetch it
		const list = await fetch(`${url}/rest/v1/providers?display_name=eq.TestProvider&select=id`, { headers: H });
		providerId = (await list.json())[0].id;
	}
	console.log('provider:', providerId);

	const modelRes = await fetch(`${url}/rest/v1/models`, {
		method: 'POST',
		headers: { ...H, Prefer: 'return=representation' },
		body: JSON.stringify({
			provider_id: providerId,
			upstream_model_id: 'test-model-' + Date.now(),
			display_name: 'Test Model',
			usage_multiplier: 2.5,
			enabled_for_users: true,
			slug: 'test-model-' + Date.now(),
			context_window: 8192,
		}),
	});
	const modelBody = await modelRes.json();
	const modelId = Array.isArray(modelBody) ? modelBody[0]?.id : modelBody.id;
	const upstreamId = Array.isArray(modelBody)
		? modelBody[0]?.upstream_model_id
		: modelBody.upstream_model_id;
	console.log('model:', modelId, '| upstream:', upstreamId);

	// 1) user + key
	const email = `gw-${Date.now()}@nexor.dev`;
	const cu = await fetch(`${url}/auth/v1/admin/users`, {
		method: 'POST', headers: H,
		body: JSON.stringify({ email, password: 'Demo1234!pass', email_confirm: true }),
	});
	const uid = (await cu.json()).id;
	const rawKey = 'sk-nexor-' + crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
	const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawKey));
	const hash = [...new Uint8Array(hashBuf)].map((b) => b.toString(16).padStart(2, '0')).join('');
	await fetch(`${url}/rest/v1/user_api_keys`, {
		method: 'POST', headers: H,
		body: JSON.stringify({ user_id: uid, name: 'test', prefix: rawKey.slice(0, 12), last4: rawKey.slice(-4), sha256_hash: hash }),
	});
	console.log('user+key ready:', email);

	const call = async (path, body, key = rawKey) => {
		const r = await fetch(GW + path, {
			method: body ? 'POST' : 'GET',
			headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
			body: body ? JSON.stringify(body) : undefined,
		});
		const text = await r.text();
		let json = null;
		try { json = JSON.parse(text); } catch {}
		return { status: r.status, json, text };
	};

	// 2) guard rails
	let r = await call('/v1/chat/completions', { model: 'x', messages: [] }, 'sk-nexor-bogus');
	console.log('bad key →', r.status, r.json?.error?.type, '(expect 401 invalid_api_key)');

	r = await call('/v1/chat/completions', { model: 'nonexistent/model', messages: [{ role: 'user', content: 'hi' }] });
	console.log('unknown model →', r.status, r.json?.error?.type, '(expect 404)');

	r = await call('/v1/chat/completions', { model: upstreamId, messages: [{ role: 'user', content: 'hello gateway' }] });
	console.log('valid req, no provider keys →', r.status, r.json?.error?.type, '(expect 503 after quota reserved)');

	r = await fetch(GW + '/v1/models').then((x) => x.json());
	console.log('/v1/models →', JSON.stringify(r).slice(0, 120));

	// 3) verify quota was reserved then check logs table empty (no settle without response)
	const du = await fetch(`${url}/rest/v1/daily_usage?user_id=eq.${uid}&select=*`, { headers: H });
	console.log('daily_usage rows:', JSON.stringify(await du.json()));

	// cleanup
	await fetch(`${url}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: H });
	console.log('done');
})();
