import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SignupForm } from '@/components/auth/signup-form';

export default async function SignupPage(props: { params: Promise<{ locale: string }> }) {
	const { locale } = await props.params;
	setRequestLocale(locale);
	const t = await getTranslations('auth');

	return (
		<section className="rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-8">
			<h1 className="text-xl font-semibold tracking-tight">{t('signupTitle')}</h1>
			<p className="mt-1 text-sm text-[var(--nx-muted)]">{t('signupSubtitle')}</p>
			<div className="mt-6">
				<SignupForm />
			</div>
		</section>
	);
}
