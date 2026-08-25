import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LoginForm } from '@/components/auth/login-form';

export default async function LoginPage(props: { params: Promise<{ locale: string }> }) {
	const { locale } = await props.params;
	setRequestLocale(locale);
	const t = await getTranslations('auth');

	return (
		<section className="rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-8">
			<h1 className="text-xl font-semibold tracking-tight">{t('loginTitle')}</h1>
			<p className="mt-1 text-sm text-[var(--nx-muted)]">{t('loginSubtitle')}</p>
			<div className="mt-6">
				<LoginForm />
			</div>
		</section>
	);
}
