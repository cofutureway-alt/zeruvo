import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';

interface AuthState {
	session: Session | null;
	user: Session['user'] | null;
	loading: boolean;
	/** null = still resolving; true/false once role is known */
	isAdmin: boolean | null;
}

const AuthCtx = createContext<AuthState>({
	session: null,
	user: null,
	loading: true,
	isAdmin: null,
});

/**
 * App-level auth provider. Resolves session AND admin role in one
 * orchestrated flow — every guard/header reads the same resolved state,
 * so there are no per-consumer races.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
	const [session, setSession] = useState<Session | null>(null);
	const [loading, setLoading] = useState(true);
	const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

	useEffect(() => {
		let cancelled = false;

		async function resolve(s: Session | null) {
			setSession(s);
			if (!s) {
				setIsAdmin(false);
				setLoading(false);
				return;
			}
			// keep loading=true while the role resolves
			const { data } = await supabase
				.from('profiles')
				.select('role')
				.eq('id', s.user.id)
				.single();
			if (cancelled) return;
			setIsAdmin(data?.role === 'admin');
			setLoading(false);
		}

		void supabase.auth.getSession().then(({ data }) => resolve(data.session));

		const {
			data: { subscription },
		} = supabase.auth.onAuthStateChange((_event, s) => {
			void resolve(s);
		});

		return () => {
			cancelled = true;
			subscription.unsubscribe();
		};
	}, []);

	return (
		<AuthCtx.Provider value={{ session, user: session?.user ?? null, loading, isAdmin }}>
			{children}
		</AuthCtx.Provider>
	);
}

export const useAuth = () => useContext(AuthCtx);
