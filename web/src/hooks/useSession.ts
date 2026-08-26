import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

/**
 * Single source of auth truth for the whole SPA.
 * One hook instance worth of state per consumer, but role is resolved
 * in the SAME effect chain as the session — no separate race.
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

export function useIsAdmin() {
	const { session } = useSession();
	const [admin, setAdmin] = useState<boolean | null>(null);

	useEffect(() => {
		if (!session) {
			setAdmin(false);
			return;
		}
		let cancelled = false;
		setAdmin(null); // resolving
		void supabase
			.from('profiles')
			.select('role')
			.eq('id', session.user.id)
			.single()
			.then(({ data }) => {
				if (!cancelled) setAdmin(data?.role === 'admin');
			});
		return () => { cancelled = true; };
	}, [session]);

	return admin;
}
