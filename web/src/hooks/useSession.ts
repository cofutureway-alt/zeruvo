import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

/**
 * Single source of auth truth for the whole SPA.
 * Boots from the restored session, then live-updates on sign-in/out.
 */
export function useSession() {
	const [session, setSession] = useState<Session | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		void supabase.auth.getSession().then(({ data }) => {
			setSession(data.session);
			setLoading(false);
		});

		const {
			data: { subscription },
		} = supabase.auth.onAuthStateChange((_event, s) => {
			setSession(s);
			setLoading(false);
		});

		return () => subscription.unsubscribe();
	}, []);

	return { session, user: session?.user ?? null, loading };
}

/** Is the current session an admin? Null while unknown. */
export function useIsAdmin() {
	const { session } = useSession();
	const [admin, setAdmin] = useState<boolean | null>(null);

	useEffect(() => {
		if (!session) {
			setAdmin(false);
			return;
		}
		void supabase
			.from('profiles')
			.select('role')
			.eq('id', session.user.id)
			.single()
			.then(({ data }) => setAdmin(data?.role === 'admin'));
	}, [session]);

	return admin;
}
