import { NewSiteHeader, NewSiteFooter } from '../../design-system/new-chrome';
import { Reveal } from '../../design-system/reveal';
import { useTranslation } from 'react-i18next';

/** Shared page chrome for the legal pages (privacy / refund) — new design. */
export function LegalPage({ title, updated, children }: {
	title: string;
	updated: string;
	children: React.ReactNode;
}) {
	const { t, i18n } = useTranslation();
	const ar = i18n.language === 'ar';
	return (
		<div className="flex min-h-screen flex-col bg-background text-foreground">
			<NewSiteHeader />
			<main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
				<Reveal>
					<h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
					<p className="mt-1 text-xs text-muted-foreground">{t('legal.lastUpdated')} {updated}</p>
				</Reveal>
				<div className="mt-8 space-y-5 text-sm leading-relaxed text-muted-foreground [&_a]:text-primary [&_a:hover]:underline [&_h2]:font-display [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground [&_li]:ms-5 [&_li]:list-disc [&_strong]:text-foreground [&_ul]:space-y-1.5 [&_section]:rounded-xl [&_section]:border [&_section]:border-border [&_section]:bg-card [&_section]:p-5">
					{children}
				</div>
			</main>
			<NewSiteFooter legal={[
				{ to: '/privacy', label: ar ? 'سياسة الخصوصية' : 'Privacy' },
				{ to: '/refund', label: ar ? 'سياسة الاسترجاع' : 'Refund policy' },
			]} />
		</div>
	);
}
