import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Hero } from '@/components/marketing/hero';

export default async function MarketingHome(props: { params: Promise<{ locale: string }> }) {
	const { locale } = await props.params;
	setRequestLocale(locale);
	const t = await getTranslations('nav');
	void t;

	return (
		<main>
			<Hero locale={locale} />
			{/* feature strip */}
			<section className="mx-auto grid max-w-6xl gap-4 px-6 pb-24 md:grid-cols-3">
				<Feature
					title="OpenAI-compatible"
					body="Point any existing SDK at our endpoint — chat completions, streaming, tools and vision just work."
				/>
				<Feature
					title="Native protocols too"
					body="/v1/messages speaks Anthropic natively; Gemini's generateContent is supported verbatim."
				/>
				<Feature
					title="Usage you can trust"
					body="Atomic per-token accounting with weighted multipliers, daily quotas and complete logs."
				/>
			</section>
		</main>
	);
}

function Feature(props: { title: string; body: string }) {
	return (
		<div className="rounded-2xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-6">
			<h3 className="font-semibold">{props.title}</h3>
			<p className="mt-2 text-sm leading-relaxed text-[var(--nx-muted)]">{props.body}</p>
		</div>
	);
}
