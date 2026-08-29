import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { GithubIcon } from './GithubIcon';
import { locales, setLocale, type Locale } from '../i18n-config';

const LOCALE_LABELS: Record<Locale, string> = {
	en: 'English',
	ar: 'العربية',
	fr: 'Français',
	zh: '中文',
};

/**
 * Site-wide footer — brand, product links, legal pages, locale switcher.
 * Rendered by AppLayout under every marketing page.
 */
export function Footer() {
	const { t, i18n } = useTranslation();

	const product = [
		{ to: '/models', label: t('nav.models') },
		{ to: '/pricing', label: t('nav.pricing') },
		{ to: '/docs', label: t('nav.docs') },
	];

	const legal = [
		{ to: '/privacy', label: t('footer.privacy') },
		{ to: '/refund', label: t('footer.refund') },
	];

	return (
		<footer className="border-t border-[var(--nx-border)] bg-[var(--nx-bg-raised)]/40">
			<div className="mx-auto grid max-w-6xl gap-10 px-6 py-12 sm:grid-cols-2 lg:grid-cols-4">
				{/* brand */}
				<div className="space-y-3">
					<div className="flex items-center gap-2.5">
						<img src="/icon.png" alt="" className="size-9 rounded-full object-contain" />
						<span className="font-display text-base font-semibold tracking-tight">Zeruvo AI</span>
					</div>
					<p className="max-w-xs text-sm leading-relaxed text-[var(--nx-muted)]">
						{t('footer.tagline')}
					</p>
					<a
						href="https://github.com"
						target="_blank"
						rel="noreferrer"
						className="inline-flex size-9 items-center justify-center rounded-full border border-[var(--nx-border)] text-[var(--nx-muted)] transition hover:border-cyan-500/60 hover:text-cyan-300"
						aria-label="GitHub"
					>
						<GithubIcon size={16} />
					</a>
				</div>

				{/* product */}
				<div>
					<p className="text-xs font-semibold uppercase tracking-wider text-zinc-300">{t('footer.product')}</p>
					<ul className="mt-4 space-y-2.5 text-sm">
						{product.map((l) => (
							<li key={l.to}>
								<Link to={l.to} className="text-[var(--nx-muted)] transition-colors hover:text-cyan-300">
									{l.label}
								</Link>
							</li>
						))}
					</ul>
				</div>

				{/* legal */}
				<div>
					<p className="text-xs font-semibold uppercase tracking-wider text-zinc-300">{t('footer.legal')}</p>
					<ul className="mt-4 space-y-2.5 text-sm">
						{legal.map((l) => (
							<li key={l.to}>
								<Link to={l.to} className="text-[var(--nx-muted)] transition-colors hover:text-cyan-300">
									{l.label}
								</Link>
							</li>
						))}
					</ul>
				</div>

				{/* locale */}
				<div>
					<p className="text-xs font-semibold uppercase tracking-wider text-zinc-300">{t('footer.language')}</p>
					<div className="mt-4 flex flex-wrap gap-2">
						{locales.map((l) => (
							<button
								key={l}
								onClick={() => setLocale(l)}
								className={`rounded-full border px-3 py-1.5 text-xs transition ${
									i18n.language === l
										? 'border-cyan-500/60 bg-cyan-500/10 text-cyan-300'
										: 'border-[var(--nx-border)] text-[var(--nx-muted)] hover:border-zinc-600 hover:text-zinc-200'
								}`}
							>
								{LOCALE_LABELS[l]}
							</button>
						))}
					</div>
				</div>
			</div>

			{/* bottom bar */}
			<div className="border-t border-[var(--nx-border)]">
				<div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-5 text-xs text-[var(--nx-muted)]">
					<p>© {new Date().getFullYear()} Zeruvo AI. {t('footer.rights')}</p>
					<p className="font-data text-[11px]">{t('footer.gatewayNote')}</p>
				</div>
			</div>
		</footer>
	);
}
