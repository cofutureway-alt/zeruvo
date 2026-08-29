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
} from 'lucide-react';
import { supabase } from '../lib/supabase';

type NavItem = {
	to: string;
	label?: string;
	labelKey?: string;
	Icon: typeof LayoutDashboard;
};

const userNav: NavItem[] = [
	{ to: '/dashboard', labelKey: 'overview', Icon: LayoutDashboard },
	{ to: '/dashboard/keys', labelKey: 'apiKeys', Icon: KeyRound },
	{ to: '/dashboard/logs', labelKey: 'logs', Icon: ScrollText },
	{ to: '/dashboard/plans', labelKey: 'plans', Icon: CreditCard },
	{ to: '/dashboard/settings', labelKey: 'settings', Icon: Settings },
];

const adminNav: NavItem[] = [
	{ to: '/admin', label: 'Overview', Icon: Boxes },
	{ to: '/admin/providers', label: 'Providers', Icon: Wallet },
	{ to: '/admin/models', label: 'Models & Categories', Icon: Building2 },
	{ to: '/admin/plans', label: 'Plans', Icon: CreditCard },
	{ to: '/admin/users', label: 'Users', Icon: Users },
	{ to: '/admin/payments', label: 'Payments', Icon: Wallet },
	{ to: '/admin/coupons', label: 'Coupons', Icon: Ticket },
	{ to: '/admin/announcements', label: 'Announcements', Icon: Megaphone },
	{ to: '/admin/gateways', label: 'Payment Gateways', Icon: Settings },
	{ to: '/admin/settings', label: 'Signup & Auth', Icon: ShieldCheck },
];

/**
 * Console shell used by both dashboards.
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

	const marqueeOffset = marqueeCount * 36;
	const nav = variant === 'user' ? userNav : adminNav;

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
		<div className="flex min-h-dvh bg-[var(--nx-bg)]">
			{/* mobile top bar — offset below any announcement marquee bars */}
			<div
				className="fixed inset-x-0 z-40 flex h-14 items-center gap-3 border-b border-[var(--nx-border)] bg-[var(--nx-surface)] px-4 lg:hidden"
				style={{ top: marqueeOffset }}
			>
				<button
					onClick={() => setMobileOpen(true)}
					className="grid size-9 shrink-0 place-items-center rounded-lg text-[var(--nx-muted)] hover:bg-zinc-800/50 hover:text-zinc-100"
					aria-label="Open menu"
				>
					<Menu size={20} />
				</button>
				<div className="flex items-center gap-2">
					<img src="/icon.png" alt="" className="size-7 shrink-0 rounded-full object-contain" />
					<span className="text-sm font-semibold tracking-tight">Zeruvo AI</span>
				</div>
			</div>

			{/* mobile drawer overlay */}
			{mobileOpen && (
				<div
					className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm lg:hidden"
					onClick={() => setMobileOpen(false)}
				/>
			)}

			<aside
				className={`fixed inset-y-0 start-0 z-50 flex w-64 shrink-0 flex-col border-e border-[var(--nx-border)] bg-[var(--nx-surface)] transition-transform duration-200 lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0 ${
					!mobileOpen ? 'max-lg:ltr:-translate-x-full max-lg:rtl:translate-x-full' : ''
				} ${collapsed ? 'lg:w-[68px]' : 'lg:w-64'}`}
				style={{ top: marqueeOffset }}
			>
				<div className="flex h-16 items-center gap-2.5 border-b border-[var(--nx-border)] px-4">
					<button
						onClick={() => setMobileOpen(false)}
						className="rounded-lg p-1 text-[var(--nx-muted)] hover:bg-zinc-800/50 hover:text-zinc-100 lg:hidden"
						aria-label="Close menu"
					>
						<X size={18} />
					</button>
					<img src="/icon.png" alt="" className="size-8 shrink-0 rounded-full object-contain" />
					<div className={`min-w-0 ${collapsed ? 'lg:hidden' : ''}`}>
							<p className="truncate text-sm font-semibold tracking-tight">Zeruvo AI</p>
							<p className="truncate text-[11px] text-[var(--nx-muted)]">
								{variant === 'admin' ? 'Admin Console' : 'Console'}
							</p>
						</div>
				</div>

				<nav className="flex-1 space-y-0.5 overflow-y-auto p-2.5">
					{nav.map(({ to, label, labelKey, Icon }) => (
						<Link
							key={to}
							to={to}
							onClick={() => setMobileOpen(false)}
							title={collapsed ? String(label ?? t(`dashboard.${labelKey}`)) : undefined}
							className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
								isActive(to)
									? 'bg-cyan-500/10 font-medium text-cyan-400'
									: 'text-[var(--nx-muted)] hover:bg-zinc-800/50 hover:text-zinc-100'
							}`}
						>
							{isActive(to) && (
								<span className="absolute inset-y-1.5 start-0 w-0.5 rounded-full bg-cyan-400" />
							)}
							<Icon size={17} className="shrink-0" />
							<span className={`truncate ${collapsed ? 'lg:hidden' : ''}`}>{label ?? t(`dashboard.${labelKey}`)}</span>
						</Link>
					))}
				</nav>

				<div className={`border-t border-[var(--nx-border)] p-2.5 ${collapsed ? 'lg:px-2.5' : ''}`}>
					<Link
						to={variant === 'admin' ? '/dashboard' : '/admin'}
						onClick={() => setMobileOpen(false)}
						className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-[var(--nx-muted)] hover:bg-zinc-800/50 hover:text-zinc-100"
					>
						<ShieldCheck size={17} className="shrink-0" />
						<span className={`${collapsed ? 'lg:hidden' : ''}`}>{variant === 'admin' ? 'User view' : 'Admin'}</span>
					</Link>
					<button
						onClick={() => { setMobileOpen(false); void logout(); }}
						className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-[var(--nx-muted)] hover:bg-zinc-800/50 hover:text-zinc-100"
					>
						<LogOut size={17} className="shrink-0" />
						<span className={`${collapsed ? 'lg:hidden' : ''}`}>{t('common.logout')}</span>
					</button>
					<div className="mt-1 flex items-center justify-between gap-2 border-t border-[var(--nx-border)] pt-2.5">
						<span className={`min-w-0 truncate px-2 text-[11px] text-[var(--nx-muted)] ${collapsed ? 'lg:hidden' : ''}`}>{email}</span>
						<button
							onClick={() => setCollapsed((c) => !c)}
							className="hidden size-8 shrink-0 place-items-center rounded-lg text-[var(--nx-muted)] hover:bg-zinc-800/50 hover:text-zinc-100 lg:grid"
							aria-label="Toggle sidebar"
						>
							{collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
						</button>
					</div>
				</div>
			</aside>

			<main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8 lg:pt-8" style={{ paddingTop: `calc(3.5rem + ${marqueeOffset + 16}px)` }}>
				{children ?? <Outlet />}
			</main>
		</div>
	);
}
