import 'server-only';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

/**
 * service_role client — NEVER import from client components.
 * Used only in server actions/routes that need admin-level access
 * (e.g. listing all users). RLS is bypassed; guard callers explicitly.
 */
export function createAdminClient() {
	return createSupabaseClient(
		process.env.NEXT_PUBLIC_SUPABASE_URL!,
		process.env.SUPABASE_SERVICE_ROLE_KEY!,
		{ auth: { autoRefreshToken: false, persistSession: false } },
	);
}
