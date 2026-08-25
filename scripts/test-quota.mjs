/**
 * Quota engine smoke test — runs against the REAL hosted database.
 * Verifies: reserve within allowance succeeds; exceeding raises QUOTA_EXCEEDED;
 * settle reconciles reservation -> consumption.
 */
import fs from 'fs';
const env = fs.readFileSync('.env.local', 'utf8');
const svc = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim();
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)[1].trim();
const base = url.replace('/rest/v1', '');
const H = { apikey: svc, Authorization: 'Bearer ' + svc, 'Content-Type': 'application/json' };

async function rpc(fn, body) {
	const r = await fetch(`${base}/rest/v1/rpc/${fn}`, {
		method: 'POST',
		headers: { ...H, Prefer: 'return=representation' },
		body: JSON.stringify(body),
	});
	return { status: r.status, json: await r.json().catch(() => null) };
}

(async () => {
	// create a throwaway auth user (service role can insert into auth.users via admin API)
	const email = `quota-test-${Date.now()}@nexor-test.local`;
	const cu = await fetch(`${base}/auth/v1/admin/users`, {
		method: 'POST',
		headers: H,
		body: JSON.stringify({ email, password: 'xT9!testPASS42', email_confirm: true }),
	});
	const cuj = await cu.json();
	const userId = cuj.id;
	console.log('user created:', cu.status, userId);

	// trigger fired? profile + default subscription
	await new Promise((r) => setTimeout(r, 500));
	const prof = await fetch(`${base}/rest/v1/profiles?id=eq.${userId}`, { headers: H });
	const subj = await fetch(
		`${base}/rest/v1/subscriptions?user_id=eq.${userId}&select=*,plans(daily_weighted_tokens)`,
		{ headers: H },
	);
	const subs = await subj.json();
	console.log('profile exists:', (await prof.json()).length === 1);
	console.log('auto-subscribed to default free plan:', subs.length === 1, '| daily allowance:', subs[0]?.plans?.daily_weighted_tokens);

	// reserve 600k (within 1M) → ok
	let r = await rpc('reserve_quota', { p_user_id: userId, p_estimate_weighted: 600000 });
	console.log('reserve 600k:', r.status === 200 ? 'OK' : 'FAIL', r.json);

	// concurrent double-spend attempt: two reserves of 300k each at once (total would exceed)
	const [a, b] = await Promise.all([
		rpc('reserve_quota', { p_user_id: userId, p_estimate_weighted: 300000 }),
		rpc('reserve_quota', { p_user_id: userId, p_estimate_weighted: 300000 }),
	]);
	const okCount = [a, b].filter((x) => x.status === 200).length;
	console.log('concurrent 300k+300k with only 400k left → allowed count:', okCount, '(expect 1)');

	// settle actual usage of first 600k reservation
	r = await rpc('settle_quota', {
		p_user_id: userId,
		p_reserved_amount: 600000,
		p_actual_weighted: 450000,
		p_log: { upstream_model: 'test/model', tokens_in: 1000, tokens_out: 500, status: 200 },
	});
	// void-returning RPCs answer 200 with empty body OR 204; both are success
	console.log('settle:', r.status === 200 || r.status === 204 ? 'OK' : 'FAIL', r.json);

	// verify daily_usage row
	const du = await fetch(`${base}/rest/v1/daily_usage?user_id=eq.${userId}&select=*`, { headers: H });
	console.log('daily_usage:', JSON.stringify(await du.json()));

	// cleanup test user
	await fetch(`${base}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: H });
	console.log('cleanup done');
})();
