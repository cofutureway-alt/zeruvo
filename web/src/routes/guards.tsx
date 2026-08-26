import { type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useSession, useIsAdmin } from '../hooks/useSession';

/**
 * Route guards — the SPA replacement for the old Next.js proxy.ts.
 * Session state comes from the live useSession() hook (restored session
 * + onAuthStateChange), so a signed-in user never sees auth pages again.
 */

export function ProtectedRoute({ children }: { children: ReactNode }) {
	const { user, loading } = useSession();
	const location = useLocation();

	if (loading) return <FullscreenSpinner />;
	if (!user) return <Navigate to="/login" replace state={{ next: location.pathname }} />;
	return children;
}

export function AdminRoute({ children }: { children: ReactNode }) {
	const { user, loading } = useSession();
	const admin = useIsAdmin();
	const location = useLocation();

	if (loading || (user && admin === null)) return <FullscreenSpinner />;
	if (!user) return <Navigate to="/login" replace state={{ next: location.pathname }} />;
	// signed in but not an admin -> bounce to their dashboard
	if (admin === false) return <Navigate to="/dashboard" replace />;
	return children;
}

/** Reverse guard: keep authenticated users off login/signup. */
export function GuestRoute({ children }: { children: ReactNode }) {
	const { user, loading } = useSession();

	if (loading) return <FullscreenSpinner />;
	if (user) return <Navigate to="/dashboard" replace />;
	return children;
}

function FullscreenSpinner() {
	return (
		<div className="grid min-h-dvh place-items-center bg-[var(--nx-bg)]">
			<div className="size-8 animate-spin rounded-full border-2 border-[var(--nx-border)] border-t-indigo-500" />
		</div>
	);
}
