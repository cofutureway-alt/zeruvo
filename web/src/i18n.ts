import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../../messages/en.json';
import ar from '../../messages/ar.json';
import fr from '../../messages/fr.json';
import zh from '../../messages/zh.json';

export const locales = ['en', 'ar', 'fr', 'zh'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';
export const rtlLocales: ReadonlySet<string> = new Set(['ar']);

export const localeFonts: Record<Locale, string> = {
	en: "'Inter', sans-serif",
	ar: "'IBM Plex Sans Arabic', sans-serif",
	fr: "'Manrope', sans-serif",
	zh: "'Noto Sans SC', sans-serif",
};

const resources = {
	en: { translation: en },
	ar: { translation: ar },
	fr: { translation: fr },
	zh: { translation: zh },
} as const;

export const i18next = i18n.use(initReactI18next).init({
	resources,
	lng: detectLocale(),
	fallbackLng: defaultLocale,
	interpolation: { escapeValue: false },
});

function detectLocale(): Locale {
	const stored = localStorage.getItem('nexor-locale') as Locale | null;
	if (stored && (locales as readonly string[]).includes(stored)) return stored;
	const nav = navigator.language.slice(0, 2) as Locale;
	return (locales as readonly string[]).includes(nav) ? nav : defaultLocale;
}

export function setLocale(locale: Locale): void {
	localStorage.setItem('nexor-locale', locale);
	void i18n.changeLanguage(locale);
	document.documentElement.lang = locale;
	document.documentElement.dir = rtlLocales.has(locale) ? 'rtl' : 'ltr';
	document.body.style.fontFamily = localeFonts[locale];
}
