import { setRequestLocale } from 'next-intl/server';
import { ModelsBrowser } from '@/components/marketing/models-browser';

export const metadata = { title: 'Models' };

export default async function ModelsDirectoryPage(props: {
	params: Promise<{ locale: string }>;
}) {
	const { locale } = await props.params;
	setRequestLocale(locale);
	return (
		<main className="mx-auto max-w-6xl px-6 py-12">
			<h1 className="text-2xl font-semibold tracking-tight">Models</h1>
			<p className="mt-1 text-sm text-[var(--nx-muted)]">
				Every model available through the Nexor gateway, with weighted pricing multipliers.
			</p>
			<ModelsBrowser />
		</main>
	);
}
