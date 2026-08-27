import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, LayoutGrid } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { SkeletonModelGrid } from '../../components/skeleton';

interface ModelRow {
	id: string;
	slug: string;
	upstream_model_id: string;
	display_name: string;
	context_window: number | null;
	usage_multiplier: number | string;
	tags: string[];
	category_name: string | null;
	category_icon: string | null;
}

export default function Models() {
	const [models, setModels] = useState<ModelRow[]>([]);
	const [loading, setLoading] = useState(true);
	const [categories, setCategories] = useState<Array<{ name: string; icon_url: string | null }>>([]);
	const [query, setQuery] = useState('');
	const [category, setCategory] = useState('all');
	const [sort, setSort] = useState<'name' | 'multiplier'>('name');

	useEffect(() => {
		void (async () => {
			const [{ data: modelRows }, { data: catRows }] = await Promise.all([
				supabase
					.from('models')
					.select('id,slug,upstream_model_id,display_name,context_window,usage_multiplier,tags,model_categories(name,icon_url)')
					.eq('enabled_for_users', true)
					.order('upstream_model_id'),
				supabase.from('model_categories').select('name,icon_url').order('sort_order'),
			]);
			setModels(
				((modelRows ?? []) as Array<Record<string, unknown>>).map((m) => {
					const cat = m.model_categories as { name?: string; icon_url?: string } | null;
					return {
						id: String(m.id),
						slug: String(m.slug),
						upstream_model_id: String(m.upstream_model_id),
						display_name: String(m.display_name),
						context_window: (m.context_window as number | null) ?? null,
						usage_multiplier: Number(m.usage_multiplier ?? 1),
						tags: (m.tags as string[]) ?? [],
						category_name: cat?.name ?? null,
						category_icon: cat?.icon_url ?? null,
					};
				}),
			);
			setCategories(catRows ?? []);
			setLoading(false);
		})();
	}, []);

	const filtered = useMemo(() => {
		let rows = models;
		if (category !== 'all') rows = rows.filter((m) => m.category_name === category);
		if (query.trim()) {
			const q = query.toLowerCase();
			rows = rows.filter(
				(m) =>
					m.upstream_model_id.toLowerCase().includes(q) ||
					m.display_name.toLowerCase().includes(q) ||
					m.tags.some((t) => t.toLowerCase().includes(q)),
			);
		}
		return [...rows].sort((a, b) =>
			sort === 'multiplier'
				? Number(b.usage_multiplier) - Number(a.usage_multiplier)
				: a.upstream_model_id.localeCompare(b.upstream_model_id),
		);
	}, [models, category, query, sort]);

	return (
		<main className="mx-auto max-w-6xl px-6 py-12">
			<h1 className="text-2xl font-semibold tracking-tight">Models</h1>
			<p className="mt-1 text-sm text-[var(--nx-muted)]">
				Every model available through the Zeruvo gateway, with weighted pricing multipliers.
			</p>

			<div className="mt-8 flex flex-wrap items-center gap-3">
				<label className="relative">
					<Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-[var(--nx-muted)]" />
					<input
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Search models…"
						className="w-72 rounded-lg border border-[var(--nx-border)] bg-transparent py-2 pe-3 ps-9 text-sm outline-none focus:border-cyan-500"
					/>
				</label>
				<div className="flex items-center gap-1.5 overflow-x-auto">
					<button
						onClick={() => setCategory('all')}
						className={`flex shrink-0 items-center rounded-full border px-3 py-1.5 text-xs ${
							category === 'all'
								? 'border-cyan-500 bg-cyan-500/10 text-cyan-300'
								: 'border-[var(--nx-border)] text-[var(--nx-muted)]'
						}`}
					>
						All
					</button>
					{categories.map((c) => (
						<button
							key={c.name}
							onClick={() => setCategory(c.name)}
							className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs ${
								category === c.name
									? 'border-cyan-500 bg-cyan-500/10 text-cyan-300'
									: 'border-[var(--nx-border)] text-[var(--nx-muted)]'
							}`}
						>
							{c.icon_url && <img src={c.icon_url} alt="" className="size-3.5 rounded-sm object-contain" />}
							{c.name}
						</button>
					))}
				</div>
				<select
					value={sort}
					onChange={(e) => setSort(e.target.value as typeof sort)}
					className="ms-auto rounded-lg border border-[var(--nx-border)] bg-[var(--nx-surface)] px-3 py-2 text-sm outline-none"
				>
					<option value="name">Sort: name</option>
					<option value="multiplier">Sort: multiplier</option>
				</select>
			</div>

			<p className="mt-4 text-xs text-[var(--nx-muted)]">
				{filtered.length} model{filtered.length === 1 ? '' : 's'}
			</p>

			{loading ? (
				<SkeletonModelGrid count={9} />
			) : (
			<div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{filtered.map((m) => (
					<Link
						key={m.id}
						to={`/models/${encodeURIComponent(m.slug)}`}
						className="group rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-4 transition hover:border-cyan-500/50"
					>
						<div className="flex items-center justify-between gap-2">
							<h3 className="truncate text-sm font-medium group-hover:text-cyan-300">{m.display_name}</h3>
							<span className="shrink-0 rounded-md bg-cyan-500/10 px-2 py-0.5 text-[11px] font-medium tabular-nums text-cyan-300">
								×{Number(m.usage_multiplier)}
							</span>
						</div>
						<p className="mt-0.5 truncate font-mono text-[11px] text-[var(--nx-muted)]">{m.upstream_model_id}</p>
						<div className="mt-3 flex items-center gap-2 text-[11px] text-[var(--nx-muted)]">
							{m.category_name && <span>{m.category_name}</span>}
							{m.context_window && <span>· {(m.context_window / 1024).toFixed(0)}K ctx</span>}
						</div>
					</Link>
				))}
			</div>

			)}
			{!loading && filtered.length === 0 && (
				<p className="mt-16 flex items-center justify-center gap-2 text-sm text-[var(--nx-muted)]">
					<LayoutGrid size={15} /> No models match.
				</p>
			)}
		</main>
	);
}
