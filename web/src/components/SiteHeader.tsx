import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LayoutDashboard } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth-context';

export function SiteHeader() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const { user, loading, isAdmin } = useAuth();
	const [open, setOpen] = useState(false);

	const links = [
		{ to: '/models', label: t('nav.models') },
		{ to: '/pricing', label: t('nav.pricing') },
		{ to: '/docs', label: t('nav.docs') },
	];

	async function logout() {
		await supabase.auth.signOut();
		navigate('/', { replace: true });
	}

	return (
		<header className="sticky top-0 z-40 border-b border-[var(--nx-border)] bg-[var(--nx-bg)]/85 backdrop-blur">
			<div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
				<Link to="/" className="flex items-center gap-2.5">
					<span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-cyan-500 to-teal-600 text-sm font-bold text-white">
						N
					</span>
					<span className="font-semibold tracking-tight">Zeruvo AI</span>
				</Link>

				<nav className="hidden items-center gap-7 text-sm md:flex">
					{links.map((l) => (
						<Link key={l.to} to={l.to} className="text-[var(--nx-muted)] transition hover:text-zinc-100">
							{l.label}
						</Link>
					))}
				</nav>

				{/* auth-aware actions */}
				<div className="hidden items-center gap-3 md:flex">
					{loading ? (
						<div className="flex items-center gap-2" aria-busy="true">
							<div className="nx-skeleton h-8 w-20 rounded-lg" />
							<div className="nx-skeleton h-8 w-24 rounded-lg" />
						</div>
					) : user ? (
						<>
							{isAdmin && (
								<Link to="/admin" className="rounded-lg px-3 py-2 text-sm text-[var(--nx-accent-strong)] transition hover:text-white">
									{t('admin.title')}
								</Link>
							)}
							<Link
								to="/dashboard"
								className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-500"
							>
								<LayoutDashboard size={15} />
								{t('nav.dashboard')}
							</Link>
							<button onClick={logout} className="rounded-lg px-3 py-2 text-sm text-[var(--nx-muted)] transition hover:text-zinc-100">
								{t('common.logout')}
							</button>
						</>
					) : (
						<>
							<Link to="/login" className="rounded-lg px-4 py-2 text-sm text-[var(--nx-muted)] transition hover:text-zinc-100">
								{t('nav.login')}
							</Link>
							<Link
								to="/signup"
								className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-500"
							>
								{t('nav.signup')}
							</Link>
						</>
					)}
				</div>

				<button onClick={() => setOpen((o) => !o)} className="grid size-9 place-items-center md:hidden" aria-label="Menu">
					<span className="space-y-1.5">
						<span className="block h-0.5 w-5 bg-current" />
						<span className="block h-0.5 w-5 bg-current" />
						<span className="block h-0.5 w-5 bg-current" />
					</span>
				</button>
			</div>

			{open && (
				<nav className="border-t border-[var(--nx-border)] px-6 py-3 md:hidden">
					{links.map((l) => (
						<Link key={l.to} to={l.to} onClick={() => setOpen(false)} className="block py-2 text-sm text-[var(--nx-muted)]">
							{l.label}
						</Link>
					))}
					{user ? (
						<div className="mt-2 space-y-2">
							<Link to="/dashboard" onClick={() => setOpen(false)} className="block rounded-lg bg-cyan-600 py-2 text-center text-sm font-medium text-white">
								{t('nav.dashboard')}
							</Link>
							<button onClick={() => { setOpen(false); void logout(); }} className="w-full rounded-lg border border-[var(--nx-border)] py-2 text-sm text-[var(--nx-muted)]">
								{t('common.logout')}
							</button>
						</div>
					) : (
						<div className="mt-2 flex gap-2">
							<Link to="/login" className="flex-1 rounded-lg border border-[var(--nx-border)] py-2 text-center text-sm">
								{t('nav.login')}
							</Link>
							<Link to="/signup" className="flex-1 rounded-lg bg-cyan-600 py-2 text-center text-sm font-medium text-white">
								{t('nav.signup')}
							</Link>
						</div>
					)}
				</nav>
			)}
		</header>
	);
}
