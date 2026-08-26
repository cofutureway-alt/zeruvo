import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { supabase, isAdmin } from '../lib/supabase';

type SessionState = 'loading' | 'authed' | 'anon';

const SessionCtx = createContext<SessionState>('loading');
export const useSessionState = () => useContext(SessionCtx);

/**
 * Route guards — the SPA replacement for the old Next.js proxy.ts.
 * Session is validated with getUser() (server-side JWT check), never getSession().
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
	const [state, setState] = useState<SessionState>('loading');
	const location = useLocation();

	useEffect(() => {
		void supabase.auth.getUser().then(({ data: { user } }) => {
			setState(user ? 'authed' : 'anon');
		});
	}, []);

	if (state === 'loading') return <FullscreenSpinner />;
	if (state === 'anon') {
		return <Navigate to="/login" replace state={{ next: location.pathname }} />;
	}
	return <SessionCtx.Provider value={state}>{children}</SessionCtx.Provider>;
}

export function AdminRoute({ children }: { children: ReactNode }) {
	const [state, setState] = useState<'loading' | 'ok' | 'user' | 'anon'>('loading');

	useEffect(() => {
		void (async () => {
			const {
				data: { user },
			} = await supabase.auth.getUser();
			if (!user) {
				setState('anon');
				return;
			}
			setState((await isAdmin()) ? 'ok' : 'user');
		})();
	}, []);

	if (state === 'loading') return <FullscreenSpinner />;
	if (state === 'anon') return <Navigate to="/login" replace />;
	if (state === 'user') return <Navigate to="/dashboard" replace />;
	return children;
}

function FullscreenSpinner() {
	return (
		<div className="grid min-h-dvh place-items-center bg-[var(--nx-bg)]">
			<div className="size-8 animate-spin rounded-full border-2 border-[var(--nx-border)] border-t-indigo-500" />
		</div>
	);
}
