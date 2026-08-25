/** Promote a user to admin + print login-ready credentials. Usage: node scripts/make-admin.mjs <email> */
import fs from 'fs';

const email = process.argv[2] ?? 'admin@nexor.dev';
const env = fs.readFileSync('.env.local', 'utf8');
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)[1].trim();
const svc = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim();
const H = { apikey: svc, Authorization: `Bearer ${svc}`, 'Content-Type': 'application/json' };

(async () => {
	// create or fetch user
	let r = await fetch(`${url}/auth/v1/admin/users`, {
		method: 'POST', headers: H,
		body: JSON.stringify({ email, password: 'Admin1234!pass', email_confirm: true }),
	});
	let j = await r.json();
	if (!r.ok && j.msg?.includes('already')) {
		const q = await fetch(`${url}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, { headers: H });
		j = (await q.json()).users?.[0];
	}
	const uid = j.id;
	console.log('user:', uid, email);

	await fetch(`${url}/rest/v1/profiles?id=eq.${uid}`, {
		method: 'PATCH', headers: H, body: JSON.stringify({ role: 'admin' }),
	});
	console.log('role: admin — password: Admin1234!pass');
})();
