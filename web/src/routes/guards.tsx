import { type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth-context';

/**
 * Route guards reading the single AuthProvider state — no races.
 */

export function ProtectedRoute({ children }: { children: ReactNode }) {
	const { user, loading } = useAuth();
	const location = useLocation();

	if (loading) return <FullscreenSpinner />;
	if (!user) return <Navigate to="/login" replace state={{ next: location.pathname }} />;
	return children;
}

export function AdminRoute({ children }: { children: ReactNode }) {
	const { user, isAdmin, loading } = useAuth();
	const location = useLocation();

	// wait until BOTH session and role are resolved
	if (loading || isAdmin === null) return <FullscreenSpinner />;
	if (!user) return <Navigate to="/login" replace state={{ next: location.pathname }} />;
	if (!isAdmin) return <Navigate to="/dashboard" replace />;
	return children;
}

/** Reverse guard: keep authenticated users off login/signup. */
export function GuestRoute({ children }: { children: ReactNode }) {
	const { user, loading } = useAuth();

	if (loading || user === undefined) return <FullscreenSpinner />;
	if (user) return <Navigate to="/dashboard" replace />;
	return children;
}

/**
 * Feature gate: a GitHub user whose GitHub account is younger than the
 * configured minimum age is held on /pending instead of the console.
 * Wrap it around ProtectedRoute (it needs the resolved session).
 */
export function PendingRoute({ children }: { children: ReactNode }) {
	const { user, loading, isAdmin, isPending } = useAuth();
	const location = useLocation();

	if (loading || isAdmin === null) return <FullscreenSpinner />;
	if (!user) return <Navigate to="/login" replace state={{ next: location.pathname }} />;
	// admins are never gated
	if (!isAdmin && isPending) return <Navigate to="/pending" replace />;
	return children;
}

function FullscreenSpinner() {
	return (
		<div className="grid min-h-dvh place-items-center bg-[var(--nx-bg)]">
			<div className="size-8 animate-spin rounded-full border-2 border-[var(--nx-border)] border-t-cyan-500" />
		</div>
	);
}
