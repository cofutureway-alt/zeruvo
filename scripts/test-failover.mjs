/**
 * Failover E2E suite against the DEPLOYED gateway + mock provider.
 *
 * Per scenario: a FLAKY provider row (primary — enabled_for_users=true, the
 * scenario's sentinel bearer key) and a GOOD provider row (fallback —
 * enabled_for_users=false, healthy mock) sharing one upstream_model_id, so
 * resolve_model picks the flaky one and resolve_model_fallbacks hands the
 * gateway the good one.
 *
 * Asserts:
 *   S1 stall-then-524 failover → immediate prelude, content from GOOD route,
 *      ONE log row billed at the PRIMARY multiplier (x2, not x1)
 *   S2 stream:false aggregate → first byte <1s despite a 20s upstream stall,
 *      body parses as chat.completion JSON
 *   S3 429 failover → content from good route
 *   S4 200-embedded-error-frame failover → content from good route
 *   S5 mid-stream drop AFTER content → honest truncation frame + [DONE],
 *      NO second-provider content (no switching after content), log
 *      error_code=upstream_disconnected
 *   S6 all providers fail → single in-band error frame, ONE log row, 0 billed
 */
import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf8');
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)[1].trim();
const svc = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim();
const dekB64 = env.match(/NEXOR_ENCRYPTION_KEY=(.+)/)[1].trim();
// workers.dev is behind Cloudflare bot protection (1042) for this account —
// hit the custom domain instead, same worker.
const GW = process.env.GW ?? 'https://api.zeruvo.online';
const MOCK = 'https://nexor-mock-llm.alammmedd4.workers.dev/v1';
const H = { apikey: svc, Authorization: `Bearer ${svc}`, 'Content-Type': 'application/json' };

let failures = 0;
function check(name, cond, detail = '') {
	console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
	if (!cond) failures++;
}

async function encryptKey(plaintext) {
	const raw = Buffer.from(dekB64, 'base64');
	const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt']);
	const nonce = crypto.getRandomValues(new Uint8Array(12));
	const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, new TextEncoder().encode(plaintext));
	return Buffer.from(Buffer.concat([Buffer.from(nonce), Buffer.from(ct)])).toString('base64');
}

async function insert(resource, row) {
	const r = await fetch(`${url}/rest/v1/${resource}`, {
		method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(row),
	});
	if (!r.ok) throw new Error(`insert ${resource}: ${r.status} ${await r.text()}`);
	return (await r.json())[0];
}

/** Read the response incrementally; resolve per-chunk arrival times. */
async function readChunks(res, maxMs = 60_000) {
	const t0 = Date.now();
	const chunks = [];
	const reader = res.body.getReader();
	const dec = new TextDecoder();
	let timer = setTimeout(() => { try { reader.cancel(); } catch {} }, maxMs);
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push({ ms: Date.now() - t0, s: dec.decode(value, { stream: true }) });
		}
	} finally {
		clearTimeout(timer);
	}
	return chunks;
}

const allText = (chunks) => chunks.map((c) => c.s).join('');

async function scenario(name, flakyBearer, stream, upstreamId, primaryMult = 2) {
	const flaky = await insert('providers', { kind: 'custom', display_name: `${name}-flaky`, base_url: MOCK, status: 'active' });
	const good = await insert('providers', { kind: 'custom', display_name: `${name}-good`, base_url: MOCK, status: 'active' });
	await insert('provider_keys', { provider_id: flaky.id, label: 'k1', encrypted_key: await encryptKey(flakyBearer), weight: 1 });
	await insert('provider_keys', { provider_id: good.id, label: 'k1', encrypted_key: await encryptKey('mock-ok'), weight: 1 });
	const primary = await insert('models', {
		provider_id: flaky.id, upstream_model_id: upstreamId, display_name: upstreamId,
		usage_multiplier: primaryMult, enabled_for_users: true, slug: `${upstreamId}-p`, context_window: 8192,
	});
	await insert('models', {
		provider_id: good.id, upstream_model_id: upstreamId, display_name: upstreamId,
		usage_multiplier: 1, enabled_for_users: false, slug: `${upstreamId}-g`, context_window: 8192,
	});
	// gating: the test user's plan has NO plan_models rows → allowed_models is
	// empty → every enabled model passes (see auth_key_lookup)
	return { flaky, good, primary, upstreamId };
}

(async () => {
	// shared test user + api key
	const email = `failover-${Date.now()}@nexor.dev`;
	const uid = (await (await fetch(`${url}/auth/v1/admin/users`, {
		method: 'POST', headers: H, body: JSON.stringify({ email, password: 'Demo1234!pass', email_confirm: true }),
	})).json()).id;
	const rawKey = 'sk-nexor-' + crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
	const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawKey));
	const hash = [...new Uint8Array(hashBuf)].map((b) => b.toString(16).padStart(2, '0')).join('');
	await insert('user_api_keys', { user_id: uid, name: 'fo', prefix: rawKey.slice(0, 12), last4: rawKey.slice(-4), sha256_hash: hash });

	// dedicated test plan with NO plan_models rows → allowed_models empty →
	// no gating. The handle_new_user trigger already attached a Starter
	// subscription (which WOULD gate), so drop it first.
	await fetch(`${url}/rest/v1/subscriptions?user_id=eq.${uid}`, { method: 'DELETE', headers: H });
	const testPlan = await insert('plans', {
		name: { en: 'failover-test' }, description: {}, daily_weighted_tokens: 1_000_000_000,
		price_usd: 0, duration_unit: 'days', duration_count: 30, is_free: true, active: false,
	});
	await insert('subscriptions', {
		user_id: uid, plan_id: testPlan.id,
		expires_at: new Date(Date.now() + 86_400_000).toISOString(), status: 'active',
	});

	const callGw = (upstreamId, body) => fetch(GW + '/v1/chat/completions', {
		method: 'POST',
		headers: { Authorization: `Bearer ${rawKey}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ model: upstreamId, messages: [{ role: 'user', content: 'x' }], ...body }),
	});
	const logsFor = async (upstreamId) => {
		await new Promise((r) => setTimeout(r, 3000));
		const r = await fetch(`${url}/rest/v1/request_logs?user_id=eq.${uid}&upstream_model=eq.${upstreamId}&select=status,error_code,tokens_in,tokens_out,weighted_tokens,model_id&order=created_at.desc`, { headers: H });
		return await r.json();
	};

	// ---- S1: stall-then-524 on primary → failover, billed ×primary multiplier
	{
		const id = `fo-s1-${Date.now()}`;
		const sc = await scenario('s1', 'flaky-stall-524', true, id);
		const t0 = Date.now();
		const res = await callGw(id, { stream: true });
		const ttfb = Date.now() - t0;
		const chunks = await readChunks(res);
		const text = allText(chunks);
		check('S1 first byte immediate (<3s, pre-stall)', ttfb < 3000, `${ttfb}ms`);
		check('S1 prelude is SSE comment', text.startsWith(': open'), JSON.stringify(text.slice(0, 12)));
		check('S1 no 524 leaked to client', res.status === 200);
		check('S1 content from GOOD route', text.includes('Mock ') && text.includes('stream!'));
		check('S1 terminal [DONE] present', text.includes('[DONE]'));
		check('S1 no error frame', !text.includes('"error"'));
		const logs = await logsFor(id);
		check('S1 exactly ONE log row', logs.length === 1, JSON.stringify(logs));
		check('S1 logged as success', logs[0]?.status === 200 && !logs[0]?.error_code);
		check('S1 billed at PRIMARY model id', logs[0]?.model_id === sc.primary.id);
		check('S1 weighted = usage(19) × 2 (primary mult)', logs[0]?.weighted_tokens === 38, String(logs[0]?.weighted_tokens));
	}

	// ---- S2: stream:false aggregate with 20s stalled primary
	{
		const id = `fo-s2-${Date.now()}`;
		await scenario('s2', 'flaky-stall-524', false, id);
		const t0 = Date.now();
		const res = await callGw(id, {}); // stream omitted → aggregate mode
		const ttfb = Date.now() - t0;
		const text = await res.text();
		check('S2 first byte immediate', ttfb < 3000, `${ttfb}ms`);
		let doc = null;
		try { doc = JSON.parse(text.replace(/^\s+/, '')); } catch { /* keep null */ }
		check('S2 body parses to chat.completion', doc?.object === 'chat.completion', text.slice(0, 80));
		check('S2 message content present', typeof doc?.choices?.[0]?.message?.content === 'string');
	}

	// ---- S3: 429 on primary → failover to good
	{
		const id = `fo-s3-${Date.now()}`;
		await scenario('s3', 'flaky-429', true, id);
		const res = await callGw(id, { stream: true });
		const text = allText(await readChunks(res));
		check('S3 content from GOOD route', text.includes('Mock ') && text.includes('[DONE]'));
		check('S3 no rate-limit frame', !text.includes('provider_rate_limited'));
	}

	// ---- S4: HTTP-200 embedded error frame → pre-content failover
	{
		const id = `fo-s4-${Date.now()}`;
		await scenario('s4', 'flaky-200-errframe', true, id);
		const res = await callGw(id, { stream: true });
		const text = allText(await readChunks(res));
		check('S4 embedded error never leaked', !text.includes('simulated provider failure'));
		check('S4 content from GOOD route', text.includes('stream!') && text.includes('[DONE]'));
	}

	// ---- S5: mid-stream drop AFTER content → honest truncation, no switch
	{
		const id = `fo-s5-${Date.now()}`;
		await scenario('s5', 'flaky-drop-mid', true, id);
		const res = await callGw(id, { stream: true });
		const text = allText(await readChunks(res));
		check('S5 partial content delivered', text.includes('partial ') && text.includes('answer'));
		check('S5 truncation error frame', text.includes('upstream_disconnected'));
		check('S5 no GOOD-route content', !text.includes('Mock '));
		check('S5 stream terminated', text.includes('[DONE]'));
		const logs = await logsFor(id);
		check('S5 one log row, flagged disconnected', logs.length === 1 && logs[0]?.error_code === 'upstream_disconnected', JSON.stringify(logs));
	}

	// ---- S6: every route fails → single in-band error, zero billing
	{
		const id = `fo-s6-${Date.now()}`;
		const flakyA = await insert('providers', { kind: 'custom', display_name: 's6-a', base_url: MOCK, status: 'active' });
		const flakyB = await insert('providers', { kind: 'custom', display_name: 's6-b', base_url: MOCK, status: 'active' });
		await insert('provider_keys', { provider_id: flakyA.id, label: 'k', encrypted_key: await encryptKey('flaky-429'), weight: 1 });
		await insert('provider_keys', { provider_id: flakyB.id, label: 'k', encrypted_key: await encryptKey('flaky-200-errframe'), weight: 1 });
		await insert('models', { provider_id: flakyA.id, upstream_model_id: id, display_name: id, usage_multiplier: 2, enabled_for_users: true, slug: `${id}-p`, context_window: 8192 });
		await insert('models', { provider_id: flakyB.id, upstream_model_id: id, display_name: id, usage_multiplier: 1, enabled_for_users: false, slug: `${id}-g`, context_window: 8192 });
		const res = await callGw(id, { stream: true });
		const text = allText(await readChunks(res));
		check('S6 200 + in-band error frame', res.status === 200 && text.includes('provider_rate_limited'), text.slice(0, 120));
		check('S6 [DONE] after error', text.includes('[DONE]'));
		const logs = await logsFor(id);
		check('S6 one log row, zero billed', logs.length === 1 && logs[0]?.weighted_tokens === 0 && logs[0]?.tokens_in === 0, JSON.stringify(logs));
		check('S6 flagged rate-limited', logs[0]?.error_code === 'provider_rate_limited');
	}

	// ---- cleanup
	await fetch(`${url}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: H });
	await fetch(`${url}/rest/v1/plans?id=eq.${testPlan.id}`, { method: 'DELETE', headers: H }).catch(() => {});
	// bulk cleanup by upstream id pattern + provider display names
	for (const pat of ['fo-s1*', 'fo-s2*', 'fo-s3*', 'fo-s4*', 'fo-s5*', 'fo-s6*']) {
		await fetch(`${url}/rest/v1/models?upstream_model_id=like.${pat}`, { method: 'DELETE', headers: H }).catch(() => {});
	}
	for (const dn of ['s1-', 's2-', 's3-', 's4-', 's5-', 's6-']) {
		await fetch(`${url}/rest/v1/providers?display_name=like.${dn}*`, { method: 'DELETE', headers: H }).catch(() => {});
	}

	console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
	process.exit(failures ? 1 : 0);
})().catch((e) => {
	console.error('suite crashed', e);
	process.exit(1);
});
