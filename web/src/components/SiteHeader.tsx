import { useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LayoutDashboard } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth-context';
import PillNav, { type PillNavItem } from './PillNav';

const ACTION_GHOST =
	'rounded-full px-3.5 py-1.5 text-sm text-[var(--nx-muted)] transition hover:bg-white/[0.06] hover:text-zinc-100';
const ACTION_SOLID =
	'flex items-center gap-1.5 rounded-full bg-[var(--nx-accent)] px-4 py-1.5 text-sm font-semibold text-[#04202a] transition hover:bg-[var(--nx-accent-strong)]';

export function SiteHeader() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const { pathname } = useLocation();
	const { user, loading, isAdmin } = useAuth();

	// Memoised: PillNav rebuilds its GSAP timelines whenever `items` changes
	// identity, which would replay the load animation on every render.
	const items = useMemo<PillNavItem[]>(
		() => [
			{ label: t('nav.models'), href: '/models' },
			{ label: t('nav.pricing'), href: '/pricing' },
			{ label: t('nav.docs'), href: '/docs' },
		],
		[t],
	);

	const activeHref = items.find((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))?.href;

	async function logout() {
		await supabase.auth.signOut();
		navigate('/', { replace: true });
	}

	const actions = loading ? (
		<div className="flex items-center gap-2 px-1" aria-busy="true">
			<div className="nx-skeleton h-8 w-16 rounded-full" />
			<div className="nx-skeleton h-8 w-24 rounded-full" />
		</div>
	) : user ? (
		<>
			{isAdmin && (
				<Link
					to="/admin"
					className="rounded-full px-3.5 py-1.5 text-sm font-medium text-[var(--nx-accent-strong)] transition hover:bg-white/[0.06] hover:text-white"
				>
					{t('admin.title')}
				</Link>
			)}
			<Link to="/dashboard" className={ACTION_SOLID}>
				<LayoutDashboard size={15} />
				{t('nav.dashboard')}
			</Link>
			<button onClick={logout} className={ACTION_GHOST}>
				{t('common.logout')}
			</button>
		</>
	) : (
		<>
			<Link to="/login" className={ACTION_GHOST}>
				{t('nav.login')}
			</Link>
			<Link to="/signup" className={ACTION_SOLID}>
				{t('nav.signup')}
			</Link>
		</>
	);

	return (
		<header className="nx-grid-header sticky top-0 z-40 py-3">
			<div className="mx-auto max-w-6xl px-4">
				<PillNav
					logo="Z"
					logoWord="Zeruvo AI"
					logoAriaLabel="Zeruvo AI — home"
					items={items}
					activeHref={activeHref}
					baseColor="var(--nx-accent-strong)"
					baseColorAlt="var(--nx-mint)"
					navBorderColor="var(--nx-border)"
					navBorderBrightColor="var(--nx-border-bright)"
					navTextColor="var(--nx-text)"
					pillTextColor="var(--nx-muted)"
					actions={actions}
					mobileExtra={(close) =>
						loading ? (
							<div className="flex gap-2 px-1" aria-busy="true">
								<div className="nx-skeleton h-10 flex-1 rounded-full" />
								<div className="nx-skeleton h-10 flex-1 rounded-full" />
							</div>
						) : user ? (
							<div className="space-y-2">
								{isAdmin && (
									<Link
										to="/admin"
										onClick={close}
										className="block rounded-full px-4 py-2.5 text-sm text-[var(--nx-accent-strong)] transition hover:bg-white/[0.06]"
									>
										{t('admin.title')}
									</Link>
								)}
								<Link
									to="/dashboard"
									onClick={close}
									className="flex items-center justify-center gap-1.5 rounded-full bg-[var(--nx-accent)] py-2.5 text-sm font-semibold text-[#04202a]"
								>
									<LayoutDashboard size={15} />
									{t('nav.dashboard')}
								</Link>
								<button
									onClick={() => {
										close();
										void logout();
									}}
									className="w-full rounded-full border border-[var(--nx-border)] py-2.5 text-sm text-[var(--nx-muted)] transition hover:text-zinc-100"
								>
									{t('common.logout')}
								</button>
							</div>
						) : (
							<div className="flex gap-2">
								<Link
									to="/login"
									onClick={close}
									className="flex-1 rounded-full border border-[var(--nx-border)] py-2.5 text-center text-sm text-[var(--nx-muted)]"
								>
									{t('nav.login')}
								</Link>
								<Link
									to="/signup"
									onClick={close}
									className="flex-1 rounded-full bg-[var(--nx-accent)] py-2.5 text-center text-sm font-semibold text-[#04202a]"
								>
									{t('nav.signup')}
								</Link>
							</div>
						)
					}
				/>
			</div>
		</header>
	);
}
