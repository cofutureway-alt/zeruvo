import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Inter, IBM_Plex_Sans_Arabic, Manrope, Noto_Sans_SC } from 'next/font/google';
import { routing } from '@/i18n/routing';
import { isLocale, localeFonts, rtlLocales } from '@/i18n/config';
import '../globals.css';

// Dedicated font per locale (product requirement — no shared font)
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const ibmPlexArabic = IBM_Plex_Sans_Arabic({
	subsets: ['arabic', 'latin'],
	weight: ['400', '500', '600', '700'],
	variable: '--font-ibm-plex-arabic',
	display: 'swap',
});
const manrope = Manrope({ subsets: ['latin'], variable: '--font-manrope', display: 'swap' });
const notoSansSC = Noto_Sans_SC({ subsets: [], weight: ['400', '500', '700'], variable: '--font-noto-sans-sc', display: 'swap' });

export function generateStaticParams() {
	return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata(props: {
	params: Promise<{ locale: string }>;
}): Promise<Metadata> {
	const { locale } = await props.params;
	if (!isLocale(locale)) return {};
	const t = await getTranslations({ locale, namespace: 'auth' });
	void t; // metadata hooks come in Phase 7 (SEO)
	return {
		title: { default: 'Nexor AI — Unified AI Gateway', template: '%s · Nexor AI' },
		alternates: {
			languages: Object.fromEntries(
				routing.locales.map((l) => [l, `/${l}`]),
			),
		},
	};
}

export default async function LocaleLayout(props: {
	children: React.ReactNode;
	params: Promise<{ locale: string }>;
}) {
	const { locale } = await props.params;
	if (!hasLocale(routing.locales, locale)) notFound();
	setRequestLocale(locale);

	const dir = rtlLocales.has(locale) ? 'rtl' : 'ltr';

	return (
		<html lang={locale} dir={dir} className="dark">
			<body
				className={`${inter.variable} ${ibmPlexArabic.variable} ${manrope.variable} ${notoSansSC.variable} antialiased bg-zinc-950 text-zinc-100`}
				style={{ '--font-locale': localeFonts[locale] } as React.CSSProperties}
			>
				<NextIntlClientProvider>{props.children}</NextIntlClientProvider>
			</body>
		</html>
	);
}
