import { useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Globe, LayoutDashboard } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth-context';
import PillNav, { type PillNavItem } from './PillNav';
import { LocaleSwitcher } from './LocaleSwitcher';
import { locales, setLocale, type Locale } from '../i18n-config';

const LOCALE_LABELS: Record<Locale, string> = {
	en: 'English',
	ar: 'العربية',
	fr: 'Français',
	zh: '中文',
};

/** Full-width language row used inside the mobile popover. */
function LanguageRow() {
	const { i18n } = useTranslation();
	return (
		<div className="mobile-row flex-wrap gap-2" role="group" aria-label="Language">
			<span className="flex items-center gap-2 text-[var(--nx-muted)]">
				<Globe size={15} />
				<span className="text-xs font-medium uppercase tracking-wide">{i18n.language}</span>
			</span>
			<span className="flex flex-1 flex-wrap justify-end gap-1.5">
				{locales.map((l) => (
					<button
						key={l}
						type="button"
						onClick={() => setLocale(l)}
						className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
							i18n.language === l
								? 'border-cyan-500/60 bg-cyan-500/10 font-medium text-cyan-300'
								: 'border-[var(--nav-border-bright)] text-[var(--nx-muted)] hover:text-zinc-100'
						}`}
					>
						{LOCALE_LABELS[l]}
					</button>
				))}
			</span>
		</div>
	);
}

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
	) : (
		<>
			<LocaleSwitcher />
			{user ? (
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
			)}
		</>
	);

	return (
		<header className="nx-grid-header sticky top-0 z-40 py-3">
			<div className="mx-auto max-w-6xl px-4">
				<PillNav
					logo={
						<img
							src="/icon.png"
							alt=""
							className="size-9 shrink-0 rounded-full object-contain"
						/>
					}
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
							<div className="space-y-1.5" aria-busy="true">
								<div className="nx-skeleton h-11 w-full rounded-full" />
								<div className="nx-skeleton h-11 w-full rounded-full" />
							</div>
						) : (
							<>
								{/* language — full-width row inside the popover */}
								<LanguageRow />
								{user ? (
									<>
										{isAdmin && (
											<Link to="/admin" onClick={close} className="mobile-row mobile-row--accent">
												{t('admin.title')}
											</Link>
										)}
										<Link to="/dashboard" onClick={close} className="mobile-row mobile-row--solid">
											{t('nav.dashboard')}
										</Link>
										<button
											type="button"
											onClick={() => {
												close();
												void logout();
											}}
											className="mobile-row mobile-row--outline"
										>
											{t('common.logout')}
										</button>
									</>
								) : (
									<>
										<Link to="/login" onClick={close} className="mobile-row mobile-row--outline">
											{t('nav.login')}
										</Link>
										<Link to="/signup" onClick={close} className="mobile-row mobile-row--solid">
											{t('nav.signup')}
										</Link>
									</>
								)}
							</>
						)
					}
				/>
			</div>
		</header>
	);
}
