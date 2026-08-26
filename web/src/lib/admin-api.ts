import { supabase } from './supabase';

/**
 * Admin API helpers. In the SPA the privileged operations (encryption,
 * Kashier signing, webhook) run in Supabase Edge Functions; catalog CRUD
 * that only touches non-secret tables can go straight through RLS-guarded
 * PostgREST using the admin's own session.
 */

export async function edgeCall<T = unknown>(name: string, body?: unknown, method = 'POST'): Promise<T> {
	const functionsUrl = import.meta.env.VITE_SUPABASE_URL.replace('.supabase.co', '.functions.supabase.co');
	const { data: { session } } = await supabase.auth.getSession();
	const res = await fetch(`${functionsUrl}/${name}`, {
		method: method === 'GET' ? 'GET' : 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${session?.access_token ?? ''}`,
			apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
		},
		body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
	});
	return (await res.json().catch(() => null)) as T;
}
