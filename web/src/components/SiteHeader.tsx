import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export function SiteHeader() {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);

	const links = [
		{ to: '/models', label: t('nav.models') },
		{ to: '/pricing', label: t('nav.pricing') },
		{ to: '/docs', label: t('nav.docs') },
	];

	return (
		<header className="sticky top-0 z-40 border-b border-[var(--nx-border)] bg-[var(--nx-bg)]/85 backdrop-blur">
			<div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
				<Link to="/" className="flex items-center gap-2.5">
					<span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-bold text-white">
						N
					</span>
					<span className="font-semibold tracking-tight">Nexor AI</span>
				</Link>

				<nav className="hidden items-center gap-7 text-sm md:flex">
					{links.map((l) => (
						<Link key={l.to} to={l.to} className="text-[var(--nx-muted)] transition hover:text-zinc-100">
							{l.label}
						</Link>
					))}
				</nav>

				<div className="hidden items-center gap-3 md:flex">
					<Link to="/login" className="rounded-lg px-4 py-2 text-sm text-[var(--nx-muted)] transition hover:text-zinc-100">
						{t('nav.login')}
					</Link>
					<Link
						to="/signup"
						className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500"
					>
						{t('nav.signup')}
					</Link>
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
					<div className="mt-2 flex gap-2">
						<Link to="/login" className="flex-1 rounded-lg border border-[var(--nx-border)] py-2 text-center text-sm">
							{t('nav.login')}
						</Link>
						<Link to="/signup" className="flex-1 rounded-lg bg-indigo-600 py-2 text-center text-sm font-medium text-white">
							{t('nav.signup')}
						</Link>
					</div>
				</nav>
			)}
		</header>
	);
}
