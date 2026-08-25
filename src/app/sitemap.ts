import type { MetadataRoute } from 'next';
import { locales } from '@/i18n/config';
import { createClient } from '@/lib/supabase/server';

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://nexor.ai';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
	const supabase = await createClient();
	const { data: models } = await supabase
		.from('models')
		.select('slug,updated_at')
		.eq('enabled_for_users', true);

	const staticPaths = ['', '/models', '/pricing', '/docs', '/login', '/signup'];
	const entries: MetadataRoute.Sitemap = [];

	for (const locale of locales) {
		for (const path of staticPaths) {
			entries.push({
				url: `${BASE}/${locale}${path}`,
				changeFrequency: path === '' ? 'daily' : 'weekly',
				priority: path === '' ? 1 : 0.7,
			});
		}
		for (const m of models ?? []) {
			entries.push({
				url: `${BASE}/${locale}/models/${m.slug}`,
				lastModified: m.updated_at ? new Date(m.updated_at) : undefined,
				changeFrequency: 'weekly',
				priority: 0.6,
			});
		}
	}
	return entries;
}
