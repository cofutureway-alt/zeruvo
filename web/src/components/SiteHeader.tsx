import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LayoutDashboard, Menu, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth-context';

const PILL = 'rounded-full border border-[var(--nx-border)] bg-[var(--nx-surface)]/70 backdrop-blur-xl';

export function SiteHeader() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const { pathname } = useLocation();
	const { user, loading, isAdmin } = useAuth();
	const [open, setOpen] = useState(false);
	const reduce = useReducedMotion();

	const links = [
		{ to: '/models', label: t('nav.models') },
		{ to: '/pricing', label: t('nav.pricing') },
		{ to: '/docs', label: t('nav.docs') },
	];

	const isActive = (to: string) => pathname === to || pathname.startsWith(`${to}/`);

	async function logout() {
		await supabase.auth.signOut();
		navigate('/', { replace: true });
	}

	return (
		<header className="nx-grid-header sticky top-0 z-40 py-3">
			<div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4">
				{/* ---- brand pill ---- */}
				<Link
					to="/"
					className={`${PILL} group flex shrink-0 items-center gap-2.5 py-1.5 pe-4 ps-1.5 shadow-lg shadow-black/20 transition hover:border-[var(--nx-border-bright)]`}
				>
					<span className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-cyan-400 to-teal-600 text-sm font-bold text-[#04202a] transition-transform group-hover:scale-105">
						Z
					</span>
					<span className="font-display text-[0.95rem] font-semibold tracking-tight">Zeruvo AI</span>
				</Link>

				{/* ---- nav pill with sliding indicator ---- */}
				<nav className={`${PILL} hidden items-center gap-1 p-1.5 shadow-lg shadow-black/20 md:flex`}>
					{links.map((l) => {
						const active = isActive(l.to);
						return (
							<Link
								key={l.to}
								to={l.to}
								className={`relative rounded-full px-4 py-1.5 text-sm transition-colors ${
									active ? 'text-[#04202a]' : 'text-[var(--nx-muted)] hover:text-zinc-100'
								}`}
							>
								{active && (
									<motion.span
										layoutId="pill-nav-indicator"
										className="absolute inset-0 -z-10 rounded-full bg-[var(--nx-accent-strong)]"
										transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }}
									/>
								)}
								<span className="relative font-medium">{l.label}</span>
							</Link>
						);
					})}
				</nav>

				{/* ---- auth-aware actions pill ---- */}
				<div className={`${PILL} hidden shrink-0 items-center gap-1 p-1.5 shadow-lg shadow-black/20 md:flex`}>
					{loading ? (
						<div className="flex items-center gap-2 px-1" aria-busy="true">
							<div className="nx-skeleton h-8 w-16 rounded-full" />
							<div className="nx-skeleton h-8 w-24 rounded-full" />
						</div>
					) : user ? (
						<>
							{isAdmin && (
								<Link
									to="/admin"
									className="rounded-full px-3.5 py-1.5 text-sm font-medium text-[var(--nx-accent-strong)] transition hover:bg-white/5 hover:text-white"
								>
									{t('admin.title')}
								</Link>
							)}
							<Link
								to="/dashboard"
								className="flex items-center gap-1.5 rounded-full bg-[var(--nx-accent)] px-4 py-1.5 text-sm font-semibold text-[#04202a] transition hover:bg-[var(--nx-accent-strong)]"
							>
								<LayoutDashboard size={15} />
								{t('nav.dashboard')}
							</Link>
							<button
								onClick={logout}
								className="rounded-full px-3.5 py-1.5 text-sm text-[var(--nx-muted)] transition hover:bg-white/5 hover:text-zinc-100"
							>
								{t('common.logout')}
							</button>
						</>
					) : (
						<>
							<Link
								to="/login"
								className="rounded-full px-3.5 py-1.5 text-sm text-[var(--nx-muted)] transition hover:bg-white/5 hover:text-zinc-100"
							>
								{t('nav.login')}
							</Link>
							<Link
								to="/signup"
								className="rounded-full bg-[var(--nx-accent)] px-4 py-1.5 text-sm font-semibold text-[#04202a] transition hover:bg-[var(--nx-accent-strong)]"
							>
								{t('nav.signup')}
							</Link>
						</>
					)}
				</div>

				{/* ---- mobile toggle ---- */}
				<button
					onClick={() => setOpen((o) => !o)}
					className={`${PILL} grid size-11 place-items-center shadow-lg shadow-black/20 md:hidden`}
					aria-label="Menu"
					aria-expanded={open}
				>
					{open ? <X size={18} /> : <Menu size={18} />}
				</button>
			</div>

			{/* ---- mobile sheet ---- */}
			<AnimatePresence>
				{open && (
					<motion.nav
						initial={reduce ? { opacity: 1 } : { opacity: 0, y: -8 }}
						animate={{ opacity: 1, y: 0 }}
						exit={reduce ? { opacity: 1 } : { opacity: 0, y: -8 }}
						transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
						className="mx-auto mt-3 max-w-6xl px-4 md:hidden"
					>
						<div className="rounded-3xl border border-[var(--nx-border)] bg-[var(--nx-surface)]/90 p-2 shadow-2xl shadow-black/40 backdrop-blur-xl">
							{links.map((l) => (
								<Link
									key={l.to}
									to={l.to}
									onClick={() => setOpen(false)}
									className={`block rounded-2xl px-4 py-2.5 text-sm transition ${
										isActive(l.to)
											? 'bg-[var(--nx-accent-strong)] font-semibold text-[#04202a]'
											: 'text-[var(--nx-muted)] hover:bg-white/5 hover:text-zinc-100'
									}`}
								>
									{l.label}
								</Link>
							))}

							<div className="my-2 h-px bg-[var(--nx-border)]" />

							{user ? (
								<div className="space-y-2">
									{isAdmin && (
										<Link
											to="/admin"
											onClick={() => setOpen(false)}
											className="block rounded-2xl px-4 py-2.5 text-sm text-[var(--nx-accent-strong)] hover:bg-white/5"
										>
											{t('admin.title')}
										</Link>
									)}
									<Link
										to="/dashboard"
										onClick={() => setOpen(false)}
										className="flex items-center justify-center gap-1.5 rounded-2xl bg-[var(--nx-accent)] py-2.5 text-sm font-semibold text-[#04202a]"
									>
										<LayoutDashboard size={15} />
										{t('nav.dashboard')}
									</Link>
									<button
										onClick={() => {
											setOpen(false);
											void logout();
										}}
										className="w-full rounded-2xl border border-[var(--nx-border)] py-2.5 text-sm text-[var(--nx-muted)] transition hover:text-zinc-100"
									>
										{t('common.logout')}
									</button>
								</div>
							) : (
								<div className="flex gap-2">
									<Link
										to="/login"
										onClick={() => setOpen(false)}
										className="flex-1 rounded-2xl border border-[var(--nx-border)] py-2.5 text-center text-sm text-[var(--nx-muted)]"
									>
										{t('nav.login')}
									</Link>
									<Link
										to="/signup"
										onClick={() => setOpen(false)}
										className="flex-1 rounded-2xl bg-[var(--nx-accent)] py-2.5 text-center text-sm font-semibold text-[#04202a]"
									>
										{t('nav.signup')}
									</Link>
								</div>
							)}
						</div>
					</motion.nav>
				)}
			</AnimatePresence>
		</header>
	);
}
