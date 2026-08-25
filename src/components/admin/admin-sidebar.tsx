'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
	Boxes,
	LayoutGrid,
	Package,
	Users,
	CreditCard,
	Ticket,
	Megaphone,
	Wallet,
	PanelLeftClose,
	PanelLeftOpen,
	LogOut,
	ArrowUpRight,
} from 'lucide-react';

const NAV = [
	{ href: '/admin', label: 'Overview', Icon: Boxes, exact: true },
	{ href: '/admin/providers', label: 'Providers', Icon: Wallet },
	{ href: '/admin/models', label: 'Models & Categories', Icon: LayoutGrid },
	{ href: '/admin/plans', label: 'Plans', Icon: Package },
	{ href: '/admin/users', label: 'Users', Icon: Users },
	{ href: '/admin/payments', label: 'Payments', Icon: CreditCard },
	{ href: '/admin/coupons', label: 'Coupons', Icon: Ticket },
	{ href: '/admin/announcements', label: 'Announcements', Icon: Megaphone },
] as const;

export function AdminSidebar({ email, onLogout }: { email: string; onLogout: () => void }) {
	const pathname = usePathname();
	const [collapsed, setCollapsed] = useState(false);

	return (
		<aside
			className={`sticky top-0 flex h-dvh shrink-0 flex-col border-e border-[var(--nx-border)] bg-[var(--nx-surface)] transition-[width] duration-200 ${
				collapsed ? 'w-[68px]' : 'w-64'
			}`}
		>
			{/* Brand */}
			<div className="flex h-16 items-center gap-2.5 border-b border-[var(--nx-border)] px-4">
				<div className="grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-bold text-white">
					N
				</div>
				{!collapsed && (
					<div className="min-w-0">
						<p className="truncate text-sm font-semibold tracking-tight">Nexor AI</p>
						<p className="truncate text-[11px] text-[var(--nx-muted)]">Admin Console</p>
					</div>
				)}
			</div>

			{/* Nav */}
			<nav className="flex-1 space-y-0.5 overflow-y-auto p-2.5">
				{NAV.map(({ href, label, Icon, ...rest }) => {
					const active = 'exact' in rest && rest.exact ? pathname === href : pathname.startsWith(href);
					return (
						<Link
							key={href}
							href={href}
							title={collapsed ? label : undefined}
							className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
								active
									? 'bg-indigo-500/10 font-medium text-indigo-400'
									: 'text-[var(--nx-muted)] hover:bg-zinc-800/50 hover:text-zinc-100'
							}`}
						>
							{active && (
								<span className="absolute inset-y-1.5 start-0 w-0.5 rounded-full bg-indigo-400" />
							)}
							<Icon size={17} className="shrink-0" />
							{!collapsed && <span className="truncate">{label}</span>}
						</Link>
					);
				})}
			</nav>

			{/* Footer */}
			<div className="border-t border-[var(--nx-border)] p-2.5">
				<a
					href="/en/dashboard"
					className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-[var(--nx-muted)] transition-colors hover:bg-zinc-800/50 hover:text-zinc-100"
				>
					<ArrowUpRight size={17} className="shrink-0" />
					{!collapsed && <span>User view</span>}
				</a>
				<button
					onClick={onLogout}
					className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-[var(--nx-muted)] transition-colors hover:bg-zinc-800/50 hover:text-zinc-100"
				>
					<LogOut size={17} className="shrink-0" />
					{!collapsed && <span>Log out</span>}
				</button>
				<div className="mt-1 flex items-center justify-between gap-2 border-t border-[var(--nx-border)] pt-2.5">
					{!collapsed && (
						<span className="min-w-0 truncate px-2 text-[11px] text-[var(--nx-muted)]">{email}</span>
					)}
					<button
						onClick={() => setCollapsed((c) => !c)}
						className="grid size-8 shrink-0 place-items-center rounded-lg text-[var(--nx-muted)] transition-colors hover:bg-zinc-800/50 hover:text-zinc-100"
						aria-label="Toggle sidebar"
					>
						{collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
					</button>
				</div>
			</div>
		</aside>
	);
}
