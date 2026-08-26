// deno-lint-ignore-file no-explicit-any
/**
 * admin-users-list — returns the auth-side user data (email, ban state,
 * created_at) merged with profile roles. Admin-only.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

	// list all auth users (paginated up to 1000/page)
	const users: Array<Record<string, unknown>> = [];
	let page = 1;
	for (;;) {
		const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 500 });
		if (error) return Response.json({ error: error.message }, { status: 500, headers: CORS_HEADERS })
		for (const u of data.users) {
			users.push({
				id: u.id,
				email: u.email,
				banned: Boolean(u.banned_until && new Date(u.banned_until) > new Date()),
				created_at: u.created_at,
				last_sign_in: u.last_sign_in_at,
			});
		}
		if (data.users.length < 500 || page > 20) break;
		page++;
	}

	return Response.json({ users }, { headers: CORS_HEADERS })
});
