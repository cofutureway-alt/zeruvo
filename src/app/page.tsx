import { redirect } from 'next/navigation';
import { defaultLocale } from '@/i18n/config';

/** Root — send visitors to the default locale marketing root. */
export default function RootPage() {
	redirect(`/${defaultLocale}`);
}
