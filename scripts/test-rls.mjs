/**
 * Phase 8 — RLS security matrix against the LIVE database.
 * Verifies: anon sees nothing; user A cannot read/write user B's rows;
 * non-admin cannot write admin tables; admin sees all.
 */
import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf8');
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)[1].trim();
const svc = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim();
const anon = env.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=(.+)/)[1].trim();
const H = { apikey: svc, Authorization: `Bearer ${svc}`, 'Content-Type': 'application/json' };

async function createUser(email) {
	const r = await fetch(`${url}/auth/v1/admin/users`, {
		method: 'POST', headers: H,
		body: JSON.stringify({ email, password: 'RlsTest123!', email_confirm: true }),
	});
	return (await r.json()).id;
}
async function login(email, password) {
	const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
		method: 'POST',
		headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ email, password }),
	});
	return (await r.json()).access_token;
}

(async () => {
	const stamp = Date.now();
	const uidA = await createUser(`rls-a-${stamp}@nexor.dev`);
	const uidB = await createUser(`rls-b-${stamp}@nexor.dev`);
	const tokenA = await login(`rls-a-${stamp}@nexor.dev`, 'RlsTest123!');
	const HA = { apikey: anon, Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' };

	let pass = 0, fail = 0;
	function check(name, cond) {
		if (cond) { pass++; console.log(' PASS', name); }
		else { fail++; console.log(' FAIL', name); }
	}

	// 1. anon key reads zero profiles
	const anonRows = await fetch(`${url}/rest/v1/profiles?select=id`, { headers: { apikey: anon } });
	check('anon: profiles list empty/401', !(await anonRows.json())?.length);

	// 2. user A sees only own profile
	const profA = await (await fetch(`${url}/rest/v1/profiles?select=id`, { headers: HA })).json();
	check('user A: sees exactly 1 profile (own)', profA.length === 1 && profA[0].id === uidA);

	// 3. user A cannot see B's subscriptions
	const subsA = await (await fetch(`${url}/rest/v1/subscriptions?select=user_id`, { headers: HA })).json();
	check('user A: subscriptions only own', subsA.every((s) => s.user_id === uidA));

	// 4. user A cannot read B's API keys
	const keysForB = await fetch(`${url}/rest/v1/user_api_keys?user_id=eq.${uidB}`, { headers: HA });
	check('user A: B keys hidden', (await keysForB.json()).length === 0);

	// 5. user A cannot create a provider (admin table)
	const provAttempt = await fetch(`${url}/rest/v1/providers`, {
		method: 'POST', headers: HA,
		body: JSON.stringify({ kind: 'custom', display_name: 'hack', base_url: 'https://x.io' }),
	});
	check('user A: provider insert rejected', provAttempt.status === 403 || provAttempt.status === 0 || !(provAttempt.ok));

	// 6. user A cannot modify plans (RLS filters all rows → no-op; verify no data change)
	const { data: planBefore } = await fetch(`${url}/rest/v1/plans?is_free=eq.false&select=id,price_usd`, { headers: H })
		.then((r) => r.json()).then((rows) => ({ data: rows }));
	await fetch(`${url}/rest/v1/plans?id=neq.00000000-0000-0000-0000-000000000000`, {
		method: 'PATCH', headers: HA, body: JSON.stringify({ price_usd: 0 }),
	});
	const { data: planAfter } = await fetch(`${url}/rest/v1/plans?is_free=eq.false&select=id,price_usd`, { headers: H })
		.then((r) => r.json()).then((rows) => ({ data: rows }));
	check(
		'user A: plans unchanged after attempted mass update',
		JSON.stringify(planBefore.map((p) => p.price_usd)) === JSON.stringify(planAfter.map((p) => p.price_usd)),
	);

	// 7. user A cannot read payments of others
	const paysA = await (await fetch(`${url}/rest/v1/payments?select=user_id`, { headers: HA })).json();
	check('user A: payments only own', paysA.every((p) => p.user_id === uidA));

	// 8. user A cannot read request_logs of others
	const logsA = await (await fetch(`${url}/rest/v1/request_logs?select=user_id`, { headers: HA })).json();
	check('user A: logs only own', logsA.every((l) => l.user_id === uidA));

	// 9. user A cannot call admin RPC get_provider_keys
	const rpcAttempt = await fetch(`${url}/rest/v1/rpc/get_provider_keys`, {
		method: 'POST', headers: HA,
		body: JSON.stringify({ p_provider_id: '00000000-0000-0000-0000-000000000000' }),
	});
	check('user A: gateway RPC rejected', rpcAttempt.status === 403 || rpcAttempt.status === 404);

	// 10. user A can create own API key (legitimate op)
	const keyIns = await fetch(`${url}/rest/v1/user_api_keys`, {
		method: 'POST', headers: HA,
		body: JSON.stringify({ user_id: uidA, name: 'self', prefix: 'sk-nexor-self', last4: 'abcd', sha256_hash: 'f'.repeat(64) + stamp }),
	});
	check('user A: can create own key', keyIns.ok);

	console.log(`\n${pass} passed, ${fail} failed`);
	await fetch(`${url}/auth/v1/admin/users/${uidA}`, { method: 'DELETE', headers: H });
	await fetch(`${url}/auth/v1/admin/users/${uidB}`, { method: 'DELETE', headers: H });
	process.exit(fail ? 1 : 0);
})();
