import { setRequestLocale } from 'next-intl/server';
import { PlansBrowser } from '@/components/dashboard/plans-browser';

export const metadata = { title: 'Pricing' };

/** Public pricing page — same cards as the dashboard, CTA goes to signup. */
export default async function PublicPricingPage(props: {
	params: Promise<{ locale: string }>;
}) {
	const { locale } = await props.params;
	setRequestLocale(locale);
	return (
		<main className="mx-auto max-w-6xl px-6 py-12">
			<h1 className="text-2xl font-semibold tracking-tight">Pricing</h1>
			<p className="mt-1 text-sm text-[var(--nx-muted)]">
				Simple plans measured in weighted tokens. Charged in EGP via Kashier.
			</p>
			<PlansBrowser />
		</main>
	);
}
