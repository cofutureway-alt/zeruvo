import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Globe, LayoutDashboard, Server, Menu, X, LogIn, LogOut } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth-context';
import { Button } from './button';
import { ThemeToggle } from './theme-toggle';
import { cn } from './utils';
import { locales, setLocale, type Locale } from '../i18n-config';

/**
 * New-design site header: sticky announcement bar + glass nav with pill links,
 * theme toggle, locale switcher, auth-aware actions, mobile drawer.
 */
export function NewSiteHeader({ announcement }: { announcement?: string | null }) {
	const { t } = useTranslation();
	const { pathname } = useLocation();
	const { user, isAdmin } = useAuth();
	const navigate = useNavigate();
	const [menuOpen, setMenuOpen] = useState(false);
	const [localeOpen, setLocaleOpen] = useState(false);
	const [bannerOpen, setBannerOpen] = useState(true);

	const navLinks = [
		{ label: t('nav.models'), to: '/models' },
		{ label: t('nav.pricing'), to: '/pricing' },
		{ label: t('nav.docs'), to: '/docs' },
	];

	// close drawers when viewport grows to desktop
	useEffect(() => {
		const mq = window.matchMedia('(min-width: 768px)');
		const onChange = (e: MediaQueryListEvent) => e.matches && setMenuOpen(false);
		mq.addEventListener('change', onChange);
		return () => mq.removeEventListener('change', onChange);
	}, []);

	// lock body scroll while the mobile drawer is open
	useEffect(() => {
		document.body.style.overflow = menuOpen ? 'hidden' : '';
		return () => {
			document.body.style.overflow = '';
		};
	}, [menuOpen]);

	async function logout() {
		await supabase.auth.signOut();
		navigate('/', { replace: true });
	}

	const isActive = (to: string) => pathname === to || pathname.startsWith(`${to}/`);

	const localeLabels: Record<Locale, string> = { en: 'EN', ar: 'ع', fr: 'FR', zh: '中' };

	return (
		<div className="sticky top-0 z-50 w-full">
			{announcement && bannerOpen && (
				<div className="relative flex items-center bg-primary text-primary-foreground">
					<div className="flex-1 overflow-hidden py-2">
						<div className="animate-marquee flex min-w-full items-center gap-16">
							{Array.from({ length: 4 }).map((_, i) => (
								<span key={i} className="whitespace-nowrap text-sm font-medium" dir="ltr">
									{announcement}
								</span>
							))}
						</div>
					</div>
					<button
						type="button"
						onClick={() => setBannerOpen(false)}
						aria-label="Dismiss announcement"
						className="mx-3 rounded p-1 transition-transform duration-200 hover:scale-110"
					>
						<X className="h-4 w-4" aria-hidden="true" />
					</button>
				</div>
			)}

			<header className="w-full border-b border-border bg-background/95 backdrop-blur-sm">
				<div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
					<Link
						to="/"
						className="group flex items-center gap-2 font-display text-lg font-semibold tracking-tight transition-opacity hover:opacity-80"
					>
						<img
							src="/icon.png"
							alt=""
							className="h-7 w-7 rounded-full object-contain transition-transform duration-500 group-hover:rotate-12"
						/>
						<span>Zeruvo AI</span>
					</Link>

					<nav className="hidden items-center gap-1 rounded-full border border-border bg-card p-1 md:flex">
						{navLinks.map((link) => (
							<Link
								key={link.to}
								to={link.to}
								data-status={isActive(link.to) ? 'active' : 'inactive'}
								className="relative rounded-full px-4 py-2 text-xs font-semibold tracking-wide text-muted-foreground transition-colors duration-300 hover:text-foreground data-[status=active]:bg-primary data-[status=active]:text-primary-foreground"
							>
								{link.label}
							</Link>
						))}
					</nav>

					<div className="flex items-center gap-1">
						{/* locale switcher */}
						<div className="relative">
							<button
								type="button"
								onClick={() => setLocaleOpen((o) => !o)}
								aria-label="Change language"
								className="flex items-center gap-1.5 rounded-md px-2 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
							>
								<Globe className="h-4 w-4" aria-hidden="true" />
								{localeLabels[(localStorage.getItem('nexor-locale') as Locale) ?? 'en']}
							</button>
							{localeOpen && (
								<>
									<div className="fixed inset-0 z-40" onClick={() => setLocaleOpen(false)} />
									<div className="absolute end-0 top-full z-50 mt-1 w-32 overflow-hidden rounded-md border border-border bg-popover p-1 shadow-md">
										{locales.map((l) => (
											<button
												key={l}
												type="button"
												onClick={() => {
													setLocale(l);
													setLocaleOpen(false);
												}}
												className={cn(
													'flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent',
													(localStorage.getItem('nexor-locale') ?? 'en') === l
														? 'font-semibold text-primary'
														: 'text-foreground',
												)}
											>
												{({ en: 'English', ar: 'العربية', fr: 'Français', zh: '中文' } as Record<Locale, string>)[l]}
												<span className="text-xs text-muted-foreground">{localeLabels[l]}</span>
											</button>
										))}
									</div>
								</>
							)}
						</div>

						<ThemeToggle />

						{user ? (
							<>
								{isAdmin && (
									<Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
										<Link to="/admin">{t('admin.title')}</Link>
									</Button>
								)}
								<Button size="sm" asChild className="gap-2 transition-transform duration-300 hover:-translate-y-0.5">
									<Link to="/dashboard">
										<LayoutDashboard className="h-4 w-4" aria-hidden="true" />
										{t('nav.dashboard')}
									</Link>
								</Button>
								<Button
									variant="ghost"
									size="icon"
									onClick={() => void logout()}
									aria-label={t('common.logout')}
									className="hidden sm:inline-flex"
								>
									<LogOut className="h-4 w-4" aria-hidden="true" />
								</Button>
							</>
						) : (
							<>
								<Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
									<Link to="/login">{t('nav.login')}</Link>
								</Button>
								<Button size="sm" asChild className="gap-2 transition-transform duration-300 hover:-translate-y-0.5">
									<Link to="/signup">
										<LogIn className="h-4 w-4" aria-hidden="true" />
										{t('nav.signup')}
									</Link>
								</Button>
							</>
						)}

						{/* mobile hamburger */}
						<Button
							variant="ghost"
							size="icon"
							className="md:hidden"
							onClick={() => setMenuOpen(true)}
							aria-label="Open menu"
						>
							<Menu className="h-5 w-5" aria-hidden="true" />
						</Button>
					</div>
				</div>
			</header>

			{/* mobile drawer */}
			{menuOpen && (
				<div className="fixed inset-0 z-[60] md:hidden">
					<div
						className="absolute inset-0 bg-black/60 backdrop-blur-sm"
						onClick={() => setMenuOpen(false)}
					/>
					<div className="animate-soft-in absolute inset-y-0 start-0 flex w-72 flex-col border-e border-border bg-background p-5">
						<div className="flex items-center justify-between">
							<span className="flex items-center gap-2 font-display text-base font-semibold">
								<img src="/icon.png" alt="" className="h-7 w-7 rounded-full object-contain" />
								Zeruvo AI
							</span>
							<Button variant="ghost" size="icon" onClick={() => setMenuOpen(false)} aria-label="Close menu">
								<X className="h-5 w-5" aria-hidden="true" />
							</Button>
						</div>
						<nav className="mt-6 flex flex-col gap-1">
							{navLinks.map((link) => (
								<Link
									key={link.to}
									to={link.to}
									onClick={() => setMenuOpen(false)}
									className={cn(
										'rounded-md px-3 py-2.5 text-sm font-medium transition-colors',
										isActive(link.to) ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
									)}
								>
									{link.label}
								</Link>
							))}
							{user ? (
								<>
									{isAdmin && (
										<Link to="/admin" onClick={() => setMenuOpen(false)} className="rounded-md px-3 py-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
											{t('admin.title')}
										</Link>
									)}
									<Link to="/dashboard" onClick={() => setMenuOpen(false)} className="rounded-md px-3 py-2.5 text-sm font-medium text-primary hover:bg-accent">
										{t('nav.dashboard')}
									</Link>
									<button onClick={() => { setMenuOpen(false); void logout(); }} className="rounded-md px-3 py-2.5 text-start text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
										{t('common.logout')}
									</button>
								</>
							) : (
								<>
									<Link to="/login" onClick={() => setMenuOpen(false)} className="rounded-md px-3 py-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
										{t('nav.login')}
									</Link>
									<Link to="/signup" onClick={() => setMenuOpen(false)} className="rounded-md bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground">
										{t('nav.signup')}
									</Link>
								</>
							)}
						</nav>
					</div>
				</div>
			)}
		</div>
	);
}

/** Marketing footer — 3-zone layout with link underline animations. */
export function NewSiteFooter({ legal }: { legal?: Array<{ to: string; label: string }> }) {
	const { t } = useTranslation();
	const year = new Date().getFullYear();

	const links = [
		{ label: t('nav.models'), to: '/models' },
		{ label: t('nav.pricing'), to: '/pricing' },
		{ label: t('nav.docs'), to: '/docs' },
		{ label: t('nav.dashboard'), to: '/dashboard' },
		...(legal ?? []),
	];

	return (
		<footer className="border-t border-border px-4 py-12 sm:px-6 lg:px-8">
			<div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 md:flex-row">
				<div className="flex items-center gap-2 font-display text-base font-semibold">
					<Server className="h-5 w-5 text-primary" aria-hidden="true" />
					<span>Zeruvo AI</span>
				</div>
				<nav className="flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground">
					{links.map((l) => (
						<Link key={l.to} to={l.to} className="link-underline transition-colors hover:text-foreground">
							{l.label}
						</Link>
					))}
				</nav>
				<p className="text-sm text-muted-foreground">
					{year} Zeruvo AI. All rights reserved.
				</p>
			</div>
		</footer>
	);
}

/** Simple stat tile used by marketing sections. */
export function MiniStat({ children }: { children: ReactNode }) {
	return <div className="px-4 py-5">{children}</div>;
}
