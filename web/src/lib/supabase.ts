import { createBrowserClient } from '@supabase/ssr';

export const supabase = createBrowserClient(
	import.meta.env.VITE_SUPABASE_URL,
	import.meta.env.VITE_SUPABASE_ANON_KEY,
);

/** Check whether the current session belongs to an admin. */
export async function isAdmin(): Promise<boolean> {
	const {
		data: { user },
	} = await supabase.auth.getUser();
	if (!user) return false;
	const { data } = await supabase.from('profiles').select('role').eq('id', user.id).single();
	return data?.role === 'admin';
}
