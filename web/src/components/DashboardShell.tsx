import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
	LayoutDashboard,
	KeyRound,
	ScrollText,
	CreditCard,
	Settings,
	LogOut,
	ShieldCheck,
	Boxes,
	Building2,
	Users,
	Ticket,
	Megaphone,
	Wallet,
	PanelLeftClose,
	PanelLeftOpen,
	Menu,
	X,
	Server,
	Gauge,
	Activity,
	Gift,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { ThemeToggle } from '../design-system/theme-toggle';

type NavItem = {
	to: string;
	label?: string;
	labelKey?: string;
	Icon: typeof LayoutDashboard;
};

const userNav: NavItem[] = [
	{ to: '/dashboard', labelKey: 'overview', Icon: LayoutDashboard },
	{ to: '/dashboard/models', label: 'Models', Icon: Boxes },
	{ to: '/dashboard/keys', labelKey: 'apiKeys', Icon: KeyRound },
	{ to: '/dashboard/logs', labelKey: 'logs', Icon: ScrollText },
	{ to: '/dashboard/usage', label: 'Usage', Icon: Activity },
	{ to: '/dashboard/wallet', label: 'Wallet', Icon: Wallet },
	{ to: '/dashboard/plans', labelKey: 'plans', Icon: CreditCard },
	{ to: '/dashboard/settings', labelKey: 'settings', Icon: Settings },
];

const adminNav: NavItem[] = [
	{ to: '/admin', label: 'Overview', Icon: Boxes },
	{ to: '/admin/providers', label: 'Providers', Icon: Server },
	{ to: '/admin/models', label: 'Models & Pricing', Icon: Building2 },
	{ to: '/admin/rate-limits', label: 'Rate Limits', Icon: Gauge },
	{ to: '/admin/credit-offers', label: 'Free Credit Offers', Icon: Gift },
	{ to: '/admin/plans', label: 'Plans', Icon: CreditCard },
	{ to: '/admin/users', label: 'Users', Icon: Users },
	{ to: '/admin/payments', label: 'Payments', Icon: Wallet },
	{ to: '/admin/coupons', label: 'Coupons', Icon: Ticket },
	{ to: '/admin/announcements', label: 'Announcements', Icon: Megaphone },
	{ to: '/admin/gateways', label: 'Payment Gateways', Icon: Settings },
	{ to: '/admin/settings', label: 'Auth & Settings', Icon: ShieldCheck },
];

/**
 * Console shell used by both dashboards — new design (workspace card,
 * primary-tinted active nav, system status, theme toggle, mobile drawer).
 * variant="user" shows the user nav; variant="admin" the admin nav
 * (routes are already guarded in main.tsx).
 */
export function DashboardShell({
	variant,
	email,
	children,
}: {
	variant: 'user' | 'admin';
	email: string;
	children?: React.ReactNode;
}) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const location = useLocation();
	const [collapsed, setCollapsed] = useState(false);
	const [mobileOpen, setMobileOpen] = useState(false);
	// the announcement marquee is a fixed 36px bar above this shell — offset
	// the mobile top bar below it so the hamburger is never covered
	const [marqueeCount, setMarqueeCount] = useState(0);

	useEffect(() => {
		const onCount = (e: Event) => setMarqueeCount((e as CustomEvent<number>).detail ?? 0);
		window.addEventListener('nexor-marquee-count', onCount);
		return () => window.removeEventListener('nexor-marquee-count', onCount);
	}, []);

	// close the drawer when the viewport grows to desktop size
	useEffect(() => {
		const mq = window.matchMedia('(min-width: 1024px)');
		const onChange = (e: MediaQueryListEvent) => e.matches && setMobileOpen(false);
		mq.addEventListener('change', onChange);
		return () => mq.removeEventListener('change', onChange);
	}, []);

	const marqueeOffset = marqueeCount * 36;
	const nav = variant === 'user' ? userNav : adminNav;
	const initials = (email.slice(0, 2) || 'ZA').toUpperCase();

	async function logout() {
		await supabase.auth.signOut();
		navigate('/login', { replace: true });
	}

	function isActive(to: string) {
		const bare = location.pathname;
		if (to === '/admin' || to === '/dashboard') return bare === to;
		return bare === to || bare.startsWith(to + '/');
	}

	return (
		<div className="console-root flex min-h-dvh bg-background text-foreground">
			{/* mobile top bar — offset below any announcement marquee bars */}
			<div
				className="fixed inset-x-0 z-40 flex h-14 items-center justify-between gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-xl lg:hidden"
				style={{ top: marqueeOffset }}
			>
				<div className="flex min-w-0 items-center gap-2">
					<button
						onClick={() => setMobileOpen(true)}
						className="grid size-9 shrink-0 place-items-center rounded-md border border-input bg-background/70 text-foreground transition-colors hover:bg-accent"
						aria-label="Open menu"
					>
						<Menu size={18} />
					</button>
					<img src="/icon.png" alt="" className="size-7 shrink-0 rounded-full object-contain" />
					<span className="truncate font-display text-sm font-semibold tracking-tight">Zeruvo AI</span>
				</div>
				<ThemeToggle />
			</div>

			{/* mobile drawer overlay */}
			{mobileOpen && (
				<div
					className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm lg:hidden"
					onClick={() => setMobileOpen(false)}
				/>
			)}

			<aside
				className={`fixed inset-y-0 start-0 z-50 flex w-72 shrink-0 flex-col border-e border-sidebar-border bg-sidebar transition-transform duration-200 lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0 lg:bg-sidebar/90 ${
					!mobileOpen ? 'max-lg:ltr:-translate-x-full max-lg:rtl:translate-x-full' : ''
				} ${collapsed ? 'lg:w-[76px]' : 'lg:w-64'}`}
				style={{ top: marqueeOffset }}
			>
				{/* brand */}
				<div className="flex h-16 items-center gap-2.5 border-b border-sidebar-border px-4">
					<button
						onClick={() => setMobileOpen(false)}
						className="rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground lg:hidden"
						aria-label="Close menu"
					>
						<X size={18} />
					</button>
					<Link to="/" className={`flex min-w-0 items-center gap-2 ${collapsed ? 'lg:hidden' : ''}`}>
						<Server size={20} className="shrink-0 text-primary" />
						<span className="min-w-0">
							<span className="block truncate font-display text-sm font-semibold">Zeruvo AI</span>
							<span className="block truncate text-[11px] text-muted-foreground">
								{variant === 'admin' ? 'Admin Console' : 'Console'}
							</span>
						</span>
					</Link>
				</div>

				{/* workspace chip */}
				<div className={`mx-3 mt-4 flex items-center gap-3 rounded-lg border border-sidebar-border bg-sidebar-accent/40 p-3 ${collapsed ? 'lg:hidden' : ''}`}>
					<span className="relative flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
						{initials}
						<span className="absolute -bottom-0.5 -end-0.5 size-2.5 rounded-full border-2 border-sidebar bg-success" />
					</span>
					<span className="min-w-0 flex-1">
						<span className="block truncate text-xs font-semibold">{email || '—'}</span>
						<span className="block truncate text-[11px] text-muted-foreground">
							{variant === 'admin' ? 'Administrator' : 'Workspace'}
						</span>
					</span>
				</div>

				<p className={`px-6 pb-2 pt-5 font-display text-[10px] font-semibold uppercase text-muted-foreground ${collapsed ? 'lg:hidden' : ''}`}>
					{variant === 'admin' ? 'Management' : 'Workspace'}
				</p>
				<nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 pb-3">
					{nav.map(({ to, label, labelKey, Icon }) => (
						<Link
							key={to}
							to={to}
							onClick={() => setMobileOpen(false)}
							title={collapsed ? String(label ?? t(`dashboard.${labelKey}`)) : undefined}
							className={`relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors duration-200 ${
								isActive(to)
									? 'bg-primary/10 font-semibold text-primary'
									: 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground'
							} ${collapsed ? 'lg:justify-center lg:px-2' : ''}`}
						>
							{isActive(to) && (
								<span className="absolute inset-y-1.5 start-0 w-0.5 rounded-full bg-primary" />
							)}
							<Icon size={17} className="shrink-0" />
							<span className={`truncate ${collapsed ? 'lg:hidden' : ''}`}>{label ?? t(`dashboard.${labelKey}`)}</span>
						</Link>
					))}
				</nav>

				{/* system status */}
				<div className={`mx-3 mb-3 rounded-lg border border-sidebar-border bg-sidebar-accent/30 p-3 ${collapsed ? 'lg:hidden' : ''}`}>
					<div className="flex items-center justify-between text-[11px]">
						<span className="font-semibold text-foreground">System status</span>
						<span className="text-success">Operational</span>
					</div>
					<div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
						<div className="h-full w-[99%] rounded-full bg-primary" />
					</div>
				</div>

				{/* footer actions */}
				<div className="flex flex-col gap-1 border-t border-sidebar-border p-3">
					<Link
						to={variant === 'admin' ? '/dashboard' : '/admin'}
						onClick={() => setMobileOpen(false)}
						className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground ${collapsed ? 'lg:justify-center lg:px-2' : ''}`}
					>
						<ShieldCheck size={17} className="shrink-0" />
						<span className={`${collapsed ? 'lg:hidden' : ''}`}>{variant === 'admin' ? 'User view' : 'Admin'}</span>
					</Link>
					<button
						onClick={() => { setMobileOpen(false); void logout(); }}
						className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive ${collapsed ? 'lg:justify-center lg:px-2' : ''}`}
					>
						<LogOut size={17} className="shrink-0" />
						<span className={`${collapsed ? 'lg:hidden' : ''}`}>{t('common.logout')}</span>
					</button>
					<div className={`mt-1 flex items-center justify-between gap-2 border-t border-sidebar-border pt-2.5 ${collapsed ? 'lg:justify-center' : ''}`}>
						<span className={`min-w-0 truncate px-2 text-[11px] text-muted-foreground ${collapsed ? 'lg:hidden' : ''}`}>{email}</span>
						<button
							onClick={() => setCollapsed((c) => !c)}
							className="hidden size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground lg:grid"
							aria-label="Toggle sidebar"
						>
							{collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
						</button>
					</div>
				</div>
			</aside>

			<main
				className="console-content min-w-0 flex-1 p-4 sm:p-6 lg:p-8"
				style={{ paddingTop: `calc(3.5rem + ${marqueeOffset + 16}px)` }}
			>
				{children ?? <Outlet />}
			</main>
		</div>
	);
}
