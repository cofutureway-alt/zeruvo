import { setRequestLocale } from 'next-intl/server';
import { PlansBrowser } from '@/components/dashboard/plans-browser';

export default async function UserPlansPage(props: { params: Promise<{ locale: string }> }) {
	const { locale } = await props.params;
	setRequestLocale(locale);
	return <PlansBrowser />;
}
