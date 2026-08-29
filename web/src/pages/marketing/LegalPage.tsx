import { useTranslation } from 'react-i18next';

/** Shared page chrome for the legal pages (privacy / refund). */
export function LegalPage({ title, updated, children }: {
	title: string;
	updated: string;
	children: React.ReactNode;
}) {
	const { t } = useTranslation();
	return (
		<main className="mx-auto max-w-3xl px-6 py-12">
			<h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
			<p className="mt-1 text-xs text-[var(--nx-muted)]">{t('legal.lastUpdated')} {updated}</p>
			<div className="mt-8 space-y-5 text-sm leading-relaxed text-[var(--nx-muted)] [&_a]:text-cyan-400 [&_a:hover]:text-cyan-300 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-zinc-100 [&_li]:ms-5 [&_li]:list-disc [&_strong]:text-zinc-100 [&_ul]:space-y-1.5">
				{children}
			</div>
		</main>
	);
}
