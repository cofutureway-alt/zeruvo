// deno-lint-ignore-file no-explicit-any
/**
 * admin-users — privileged user management for the admin console.
 * Admin-only; every action is written to audit_logs.
 *
 * Actions:
 *   set_role      { user_id, role: 'admin'|'user' }
 *   ban           { user_id }            (auth ban_duration: permanent)
 *   unban         { user_id }
 *   delete        { user_id }
 *   reset_password { user_id, new_password }
 *   change_email  { user_id, new_email }
 *   move_plan     { user_id, plan_id, duration_unit?, duration_count? }
 *   revoke_plan   { user_id }            (cancels active subscriptions)
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/** Strip secrets from the body before writing to audit_logs. */
function sanitizeForAudit(action: string, body: Record<string, any>): Record<string, any> {
	const clone = { ...body };
	delete clone.new_password;
	if (action === 'change_email') clone.old_email_redacted = true;
	return clone;
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

	let body: Record<string, any>;
	try {
		body = await req.json();
	} catch {
		return Response.json({ error: 'invalid json' }, { status: 400, headers: CORS_HEADERS })
	}
	const action = body.action as string;
	const targetId = body.user_id as string;
	if (!action || !targetId) return Response.json({ error: 'action + user_id required' }, { status: 400, headers: CORS_HEADERS })

	let result: any = null;
	let error: string | null = null;

	// Guard: admins cannot ban/delete/demote THEMSELVES, and the system
	// can never end up with zero admins (DB triggers also enforce this).
	const selfTargeting = targetId === user.id;
	if (selfTargeting && ['ban', 'delete'].includes(action)) {
		return Response.json({ error: 'you cannot ban or delete your own account' }, { status: 400, headers: CORS_HEADERS })
	}

	async function demoteLastAdminGuard(targetProfileId: string): Promise<string | null> {
		const { data: target } = await admin.from('profiles').select('role').eq('id', targetProfileId).single();
		if (target?.role !== 'admin') return null;
		const { count } = await admin
			.from('profiles').select('id', { count: 'exact', head: true })
			.eq('role', 'admin').neq('id', targetProfileId);
		if ((count ?? 0) === 0) return 'cannot remove the last admin';
		return null;
	}

	switch (action) {
		case 'set_role': {
			const role = body.role === 'admin' ? 'admin' : 'user';
			if (selfTargeting && role === 'user') {
				error = await demoteLastAdminGuard(targetId)
					?? 'you cannot demote your own admin account';
				if (error) break;
			}
			if (role === 'user') {
				error = await demoteLastAdminGuard(targetId);
				if (error) break;
			}
			({ error } = await admin.from('profiles').update({ role }).eq('id', targetId));
			result = { role };
			break;
		}
		case 'ban': {
			error = await demoteLastAdminGuard(targetId);
			if (error) break;
			({ error } = await admin.auth.admin.updateUserById(targetId, { ban_duration: '876000h' }));
			result = { banned: true };
			break;
		}
		case 'unban': {
			({ error } = await admin.auth.admin.updateUserById(targetId, { ban_duration: 'none' }));
			result = { banned: false };
			break;
		}
		case 'delete': {
			error = await demoteLastAdminGuard(targetId);
			if (error) break;
			({ error } = await admin.auth.admin.deleteUser(targetId));
			result = { deleted: true };
			break;
		}
		case 'reset_password': {
			const pw = String(body.new_password ?? '');
			if (pw.length < 8) { error = 'password too short (min 8)'; break; }
			({ error } = await admin.auth.admin.updateUserById(targetId, { password: pw }));
			result = { password_reset: true };
			break;
		}
		case 'change_email': {
			const email = String(body.new_email ?? '').trim();
			if (!/.+@.+\..+/.test(email)) { error = 'invalid email'; break; }
			({ error } = await admin.auth.admin.updateUserById(targetId, { email }));
			result = { email };
			break;
		}
		case 'move_plan': {
			const planId = body.plan_id as string;
			if (!planId) { error = 'plan_id required'; break; }
			const { data: plan } = await admin
				.from('plans').select('duration_unit,duration_count').eq('id', planId).single();
			if (!plan) { error = 'plan not found'; break; }

			const now = new Date();
			const expires = new Date(now);
			const unit = (body.duration_unit as string) ?? plan.duration_unit;
			const count = Number(body.duration_count ?? plan.duration_count);
			if (unit === 'days') expires.setDate(expires.getDate() + count);
			else if (unit === 'months') expires.setMonth(expires.getMonth() + count);
			else expires.setFullYear(expires.getFullYear() + count);

			await admin.from('subscriptions').update({ status: 'canceled' })
				.eq('user_id', targetId).eq('status', 'active');
			({ error } = await admin.from('subscriptions').insert({
				user_id: targetId, plan_id: planId,
				started_at: now.toISOString(), expires_at: expires.toISOString(), status: 'active',
			}));
			result = { plan_id: planId, expires_at: expires.toISOString() };
			break;
		}
		case 'revoke_plan': {
			({ error } = await admin.from('subscriptions').update({ status: 'canceled' })
				.eq('user_id', targetId).eq('status', 'active'));
			result = { revoked: true };
			break;
		}
		default:
			return Response.json({ error: `unknown action ${action}` }, { status: 400, headers: CORS_HEADERS })
	}

	if (error) {
		return Response.json({ error: typeof error === 'string' ? error : (error as any).message ?? 'failed' }, { status: 500, headers: CORS_HEADERS })
	}

	await admin.from('audit_logs').insert({
		admin_id: user.id,
		action: `admin_users.${action}`,
		target_table: 'auth.users',
		target_id: targetId,
		diff: sanitizeForAudit(action, body),
	});

	return Response.json({ ok: true, result }, { headers: CORS_HEADERS })
});
