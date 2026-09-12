import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { NewSiteHeader, NewSiteFooter } from '../../design-system/new-chrome';
import { Reveal } from '../../design-system/reveal';
import { ProviderMark } from '../../design-system/brand-marks';
import { Input } from '../../design-system/input';
import { Card, CardContent } from '../../design-system/card';

/**
 * New-design model catalog. Live Supabase data: enabled models + admin
 * categories as filter chips, weighted multipliers, search + sort.
 * Upstream provider names are never shown to the public.
 */
interface ModelRow {
	id: string;
	slug: string;
	upstream_model_id: string;
	display_name: string;
	usage_multiplier: number;
	category_name: string;
}

export default function Models() {
	const { t, i18n } = useTranslation();
	const [models, setModels] = useState<ModelRow[]>([]);
	const [loading, setLoading] = useState(true);
	const [categories, setCategories] = useState<string[]>([]);
	const [query, setQuery] = useState('');
	const [category, setCategory] = useState('All');
	const [sort, setSort] = useState<'name' | 'multiplier'>('name');

	useEffect(() => {
		void (async () => {
			const { data } = await supabase
				.from('models')
				.select('id,slug,upstream_model_id,display_name,usage_multiplier,model_categories(name)')
				.eq('enabled_for_users', true)
				.order('upstream_model_id');
			const rows = ((data ?? []) as Array<Record<string, unknown>>).map((m) => ({
				id: String(m.id),
				slug: String(m.slug),
				upstream_model_id: String(m.upstream_model_id),
				display_name: String(m.display_name),
				usage_multiplier: Number(m.usage_multiplier ?? 1),
				category_name: String((m.model_categories as { name?: string } | null)?.name ?? 'Others'),
			}));
			setModels(rows);
			setCategories([...new Set(rows.map((r) => r.category_name))]);
			setLoading(false);
		})();
	}, []);

	const filtered = useMemo(() => {
		const list = models.filter((m) => {
			const q = query.toLowerCase();
			const matchesQuery = !q || m.display_name.toLowerCase().includes(q) || m.upstream_model_id.toLowerCase().includes(q);
			const matchesProvider = category === 'All' || m.category_name === category;
			return matchesQuery && matchesProvider;
		});
		return [...list].sort((a, b) =>
			sort === 'name' ? a.display_name.localeCompare(b.display_name) : b.usage_multiplier - a.usage_multiplier,
		);
	}, [models, query, category, sort]);

	return (
		<div className="flex min-h-screen flex-col bg-background text-foreground">
			<NewSiteHeader />
			<main className="flex-1 px-4 py-14 sm:px-6 lg:px-8">
				<div className="mx-auto max-w-6xl">
					<Reveal>
						<h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
							{i18n.language === 'ar' ? 'الموديلات' : 'Models'}
						</h1>
						<p className="mt-3 text-muted-foreground">
							{i18n.language === 'ar'
								? 'كل موديل متاح عبر بوابة Zeruvo، مع معاملات الأسعار المرجّحة.'
								: `Every model available through the Zeruvo gateway, with weighted pricing multipliers.`}
						</p>
					</Reveal>

					<Reveal delay={100} className="mt-8">
						<div className="flex flex-wrap items-center gap-3">
							<div className="relative w-full max-w-xs">
								<Search
									className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
									aria-hidden="true"
								/>
								<Input
									value={query}
									onChange={(e) => setQuery(e.target.value)}
									placeholder={i18n.language === 'ar' ? 'ابحث عن موديل…' : 'Search models...'}
									aria-label="Search models"
									className="rounded-full pl-9"
								/>
							</div>

							<div className="flex flex-wrap items-center gap-2">
								{['All', ...categories].map((p) => (
									<button
										key={p}
										type="button"
										onClick={() => setCategory(p)}
										className={`rounded-full border px-4 py-1.5 text-sm transition-all duration-300 hover:-translate-y-0.5 ${
											category === p
												? 'border-primary bg-primary text-primary-foreground'
												: 'border-border bg-card text-muted-foreground hover:text-foreground'
										}`}
									>
										{p}
									</button>
								))}
							</div>

							<label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
								<span className="sr-only">Sort models</span>
								<select
									value={sort}
									onChange={(e) => setSort(e.target.value as 'name' | 'multiplier')}
									className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
								>
									<option value="name">{i18n.language === 'ar' ? 'ترتيب: الاسم' : 'Sort: name'}</option>
									<option value="multiplier">{i18n.language === 'ar' ? 'ترتيب: المعامل' : 'Sort: multiplier'}</option>
								</select>
							</label>
						</div>
					</Reveal>

					<p className="mt-6 text-sm text-muted-foreground">
						{loading ? '…' : `${filtered.length} ${i18n.language === 'ar' ? 'موديل' : 'models'}`}
					</p>

					<div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
						{filtered.map((model, index) => (
							<Reveal key={model.id} delay={Math.min(index, 8) * 60} className="h-full">
								<Link to={`/models/${model.slug}`} className="block h-full">
									<Card className="hover-lift h-full border-border bg-card hover:border-primary/50">
										<CardContent className="p-5">
											<div className="flex items-start justify-between gap-3">
												<h2 className="font-display text-base font-semibold">{model.display_name}</h2>
												<span className="shrink-0 rounded bg-primary/15 px-2 py-1 font-mono text-xs text-primary">
													×{model.usage_multiplier}
												</span>
											</div>
											<p className="mt-1 truncate font-mono text-xs text-muted-foreground">{model.upstream_model_id}</p>
											<p className="mt-4 inline-flex items-center gap-2 text-sm text-muted-foreground">
												<ProviderMark name={model.category_name} className="h-4 w-4" />
												{model.category_name}
											</p>
										</CardContent>
									</Card>
								</Link>
							</Reveal>
						))}
					</div>

					{!loading && filtered.length === 0 ? (
						<p className="mt-10 text-center text-sm text-muted-foreground">
							{i18n.language === 'ar' ? 'لا موديلات تطابق البحث.' : 'No models match your filters.'}
						</p>
					) : null}
				</div>
			</main>
			<NewSiteFooter legal={[
				{ to: '/privacy', label: i18n.language === 'ar' ? 'سياسة الخصوصية' : 'Privacy' },
				{ to: '/refund', label: i18n.language === 'ar' ? 'سياسة الاسترجاع' : 'Refund policy' },
			]} />
		</div>
	);
}
