import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';

export type SignupMode = 'email_and_github' | 'github_only' | 'disabled';

interface AuthState {
	session: Session | null;
	user: Session['user'] | null;
	loading: boolean;
	/** null = still resolving; true/false once role is known */
	isAdmin: boolean | null;
	/** Site-wide signup mode from app_settings (null = still loading). */
	signupMode: SignupMode | null;
	/** Minimum age (days) a GitHub account must have; 0 = no gate. */
	githubMinAgeDays: number;
	/**
	 * true = logged-in GitHub user whose GitHub account is younger than the
	 * configured minimum age → features locked behind /pending.
	 * Always false for email users or when the gate is off.
	 */
	isPending: boolean;
	/** Date the pending period ends, or null. */
	pendingUntil: Date | null;
}

const AuthCtx = createContext<AuthState>({
	session: null,
	user: null,
	loading: true,
	isAdmin: null,
	signupMode: null,
	githubMinAgeDays: 0,
	isPending: false,
	pendingUntil: null,
});

/** Read the GitHub account creation date via the provider token and persist it. */
async function captureGithubCreatedAt(s: Session, known: Date | null): Promise<void> {
	if (!s.provider_token) return;
	// only for GitHub identities, and only until we have a stored date
	if (s.user.app_metadata?.provider !== 'github' && !(s.user.app_metadata?.providers ?? []).includes('github')) return;
	if (known) return;
	try {
		const res = await fetch('https://api.github.com/user', {
			headers: { Authorization: `Bearer ${s.provider_token}`, Accept: 'application/vnd.github+json' },
		});
		if (!res.ok) return;
		const created = (await res.json()).created_at as string | undefined;
		if (!created) return;
		await supabase.from('profiles').update({ github_created_at: created }).eq('id', s.user.id);
	} catch {
		// non-fatal — the gate treats a missing date as "unknown", pending until captured
	}
}

/**
 * App-level auth provider. Resolves session AND admin role in one
 * orchestrated flow — every guard/header reads the same resolved state,
 * so there are no per-consumer races.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
	const [session, setSession] = useState<Session | null>(null);
	const [loading, setLoading] = useState(true);
	const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
	const [signupMode, setSignupMode] = useState<SignupMode | null>(null);
	const [githubMinAgeDays, setGithubMinAgeDays] = useState(0);
	const [isPending, setIsPending] = useState(false);
	const [pendingUntil, setPendingUntil] = useState<Date | null>(null);

	// site-wide signup config — read once, refresh on each login/logout
	useEffect(() => {
		void supabase
			.from('app_settings')
			.select('signup_mode, github_min_age_days')
			.eq('id', 1)
			.maybeSingle()
			.then(({ data }) => {
				if (data) {
					setSignupMode(data.signup_mode as SignupMode);
					setGithubMinAgeDays(data.github_min_age_days ?? 0);
				} else {
					setSignupMode('email_and_github');
					setGithubMinAgeDays(0);
				}
			});
	}, []);

	useEffect(() => {
		let cancelled = false;

		async function resolve(s: Session | null) {
			setSession(s);
			if (!s) {
				setIsAdmin(false);
				setIsPending(false);
				setPendingUntil(null);
				setLoading(false);
				return;
			}
			// keep loading=true while profile resolves
			const { data } = await supabase
				.from('profiles')
				.select('role, github_created_at')
				.eq('id', s.user.id)
				.single();
			if (cancelled) return;
			setIsAdmin(data?.role === 'admin');

			const isGithub = s.user.app_metadata?.provider === 'github'
				|| (s.user.app_metadata?.providers ?? []).includes('github');
			const stored = data?.github_created_at ? new Date(data.github_created_at) : null;

			// capture the GitHub account age on first OAuth session, then persist
			if (isGithub && !stored) void captureGithubCreatedAt(s, null);

			if (!isGithub || githubMinAgeDays <= 0) {
				setIsPending(false);
				setPendingUntil(null);
			} else if (stored) {
				const until = new Date(stored.getTime() + githubMinAgeDays * 86_400_000);
				setIsPending(until.getTime() > Date.now());
				setPendingUntil(until > new Date() ? until : null);
			} else {
				// GitHub user, gate on, age not captured yet — treat as pending
				// until the capture effect stores the date and re-resolves.
				setIsPending(true);
				setPendingUntil(null);
			}
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
		// re-resolve when the age threshold changes so isPending stays accurate
	}, [githubMinAgeDays]);

	// once the capture effect persists github_created_at, re-run the pending
	// computation with the real date
	useEffect(() => {
		if (!session || !isPending || pendingUntil) return;
		let cancelled = false;
		const t = setTimeout(() => {
			void supabase
				.from('profiles')
				.select('github_created_at')
				.eq('id', session.user.id)
				.single()
				.then(({ data }) => {
					if (cancelled || !data?.github_created_at) return;
					const stored = new Date(data.github_created_at);
					const until = new Date(stored.getTime() + githubMinAgeDays * 86_400_000);
					setIsPending(until.getTime() > Date.now());
					setPendingUntil(until > new Date() ? until : null);
				});
		}, 1500);
		return () => {
			cancelled = true;
			clearTimeout(t);
		};
	}, [session, isPending, pendingUntil, githubMinAgeDays]);

	return (
		<AuthCtx.Provider
			value={{
				session,
				user: session?.user ?? null,
				loading,
				isAdmin,
				signupMode,
				githubMinAgeDays,
				isPending,
				pendingUntil,
			}}
		>
			{children}
		</AuthCtx.Provider>
	);
}

export const useAuth = () => useContext(AuthCtx);
