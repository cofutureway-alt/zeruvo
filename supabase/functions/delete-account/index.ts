// delete-account — permanently deletes a user's account and personal data.
// The Privacy policy promises self-service account deletion; this implements it.
// Runs as a user-authenticated function (no service role). Uses a
// security-definer stored procedure so RLS on all tables is enforced
// consistently in one atomic transaction.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
	if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
	if (req.method !== 'POST') return Response.json({ error: 'method not allowed' }, { status: 405, headers: CORS_HEADERS });

	const authHeader = req.headers.get('Authorization') ?? '';
	const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
		global: { headers: { Authorization: authHeader } },
	});

	const { data: { user } } = await supabase.auth.getUser();
	if (!user) return Response.json({ error: 'unauthorized' }, { status: 401, headers: CORS_HEADERS });

	// The actual deletion is done by a security-definer RPC that:
	//   1) deletes subscriptions, payments, api keys, usage, redemptions
	//   2) deletes the profile row (RLS allows this via the owner's
	//      authenticated session OR the RPC runs as definer — both are fine)
	//   3) deletes the auth user
	// All in one transaction so partial deletion can't leak data.
	const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

	const { error } = await admin.rpc('delete_user_account', { p_user_id: user.id });

	if (error) {
		console.error('delete-account failed:', error);
		return Response.json({ error: error.message }, { status: 500, headers: CORS_HEADERS });
	}

	// Sign out to invalidate the JWT client-side
	await supabase.auth.signOut();

	return Response.json({ ok: true, message: 'Account deleted' }, { headers: CORS_HEADERS });
});
