export const locales = ['en', 'ar', 'fr', 'zh'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';

/** RTL languages — Arabic only in v1. */
export const rtlLocales: ReadonlySet<string> = new Set(['ar']);

/** Dedicated font stack per locale (per product requirement). */
export const localeFonts: Record<Locale, string> = {
	en: 'var(--font-inter)',
	ar: 'var(--font-ibm-plex-arabic)',
	fr: 'var(--font-manrope)',
	zh: 'var(--font-noto-sans-sc)',
};

export function isLocale(value: string): value is Locale {
	return (locales as readonly string[]).includes(value);
}
