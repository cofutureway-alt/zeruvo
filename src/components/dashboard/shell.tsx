'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/client';
import {
	LayoutDashboard,
	KeyRound,
	ScrollText,
	CreditCard,
	Settings,
	LogOut,
	ShieldCheck,
} from 'lucide-react';

const userNav = [
	{ href: '/dashboard', labelKey: 'overview', Icon: LayoutDashboard },
	{ href: '/dashboard/keys', labelKey: 'apiKeys', Icon: KeyRound },
	{ href: '/dashboard/logs', labelKey: 'logs', Icon: ScrollText },
	{ href: '/dashboard/plans', labelKey: 'plans', Icon: CreditCard },
	{ href: '/dashboard/settings', labelKey: 'settings', Icon: Settings },
] as const;

export function DashboardShell(props: {
	children: React.ReactNode;
	email: string;
	isAdmin: boolean;
}) {
	const t = useTranslations('dashboard');
	const router = useRouter();

	async function logout() {
		await createClient().auth.signOut();
		router.replace('/login');
	}

	return (
		<div className="flex min-h-dvh">
			<aside className="w-60 shrink-0 border-e border-[var(--nx-border)] bg-[var(--nx-surface)] p-4">
				<p className="px-2 pb-4 text-lg font-semibold tracking-tight">Nexor AI</p>
				<nav className="space-y-1">
					{userNav.map(({ href, labelKey, Icon }) => (
						<Link
							key={href}
							href={href as '/' & string}
							className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-[var(--nx-muted)] hover:bg-zinc-800/60 hover:text-[var(--nx-text)]"
						>
							<Icon size={16} />
							{t(labelKey)}
						</Link>
					))}
					{props.isAdmin && (
						<Link
							href="/admin"
							className="mt-2 flex items-center gap-2 rounded-lg border border-[var(--nx-border)] px-3 py-2 text-sm text-[var(--nx-accent-strong)]"
						>
							<ShieldCheck size={16} />
							Admin
						</Link>
					)}
				</nav>
			</aside>
			<div className="flex min-w-0 flex-1 flex-col">
				<header className="flex items-center justify-between border-b border-[var(--nx-border)] px-6 py-3">
					<span className="text-sm text-[var(--nx-muted)]">{props.email}</span>
					<button
						onClick={logout}
						className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-[var(--nx-muted)] hover:bg-zinc-800/60 hover:text-[var(--nx-text)]"
					>
						<LogOut size={15} />
						{t('logout')}
					</button>
				</header>
				<main className="flex-1 p-6">{props.children}</main>
			</div>
		</div>
	);
}
