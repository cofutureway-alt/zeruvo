import { defineRouting } from 'next-intl/routing';
import { defaultLocale, locales } from './config';

export const routing = defineRouting({
	locales,
	defaultLocale,
	localePrefix: 'always', // /en, /ar, /fr, /zh — clean hreflang targets
});
