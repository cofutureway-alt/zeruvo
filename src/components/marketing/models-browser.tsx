'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Search, LayoutGrid } from 'lucide-react';

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

interface CategoryRow {
	name: string;
	icon_url: string | null;
}

export function ModelsBrowser() {
	const [models, setModels] = useState<ModelRow[]>([]);
	const [categories, setCategories] = useState<CategoryRow[]>([]);
	const [query, setQuery] = useState('');
	const [category, setCategory] = useState<string>('all');
	const [sort, setSort] = useState<'name' | 'multiplier'>('name');

	useEffect(() => {
		void (async () => {
			const { createClient } = await import('@/lib/supabase/client');
			const supabase = createClient();
			const [{ data: modelRows }, { data: catRows }] = await Promise.all([
				supabase
					.from('models')
					.select(
						'id,slug,upstream_model_id,display_name,context_window,usage_multiplier,tags,model_categories(name,icon_url)',
					)
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
		<div className="mt-8">
			{/* controls */}
			<div className="flex flex-wrap items-center gap-3">
				<label className="relative">
					<Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-[var(--nx-muted)]" />
					<input
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Search models…"
						className="w-72 rounded-lg border border-[var(--nx-border)] bg-transparent py-2 pe-3 ps-9 text-sm outline-none focus:border-indigo-500"
					/>
				</label>

				<div className="flex items-center gap-1.5 overflow-x-auto">
					<FilterChip active={category === 'all'} onClick={() => setCategory('all')} label="All" />
					{categories.map((c) => (
						<FilterChip
							key={c.name}
							active={category === c.name}
							onClick={() => setCategory(c.name)}
							label={c.name}
							iconUrl={c.icon_url}
						/>
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

			{/* grid */}
			<div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{filtered.map((m) => (
					<Link
						key={m.id}
						href={`/en/models/${m.slug}`}
						className="group rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-4 transition hover:border-indigo-500/50"
					>
						<div className="flex items-center justify-between gap-2">
							<h3 className="truncate text-sm font-medium group-hover:text-indigo-300">
								{m.display_name}
							</h3>
							<span className="shrink-0 rounded-md bg-indigo-500/10 px-2 py-0.5 text-[11px] font-medium tabular-nums text-indigo-300">
								×{Number(m.usage_multiplier)}
							</span>
						</div>
						<p className="mt-0.5 truncate font-mono text-[11px] text-[var(--nx-muted)]">
							{m.upstream_model_id}
						</p>
						<div className="mt-3 flex items-center gap-2 text-[11px] text-[var(--nx-muted)]">
							{m.category_name && <span>{m.category_name}</span>}
							{m.context_window && <span>· {(m.context_window / 1024).toFixed(0)}K ctx</span>}
						</div>
					</Link>
				))}
			</div>

			{filtered.length === 0 && (
				<p className="mt-16 flex items-center justify-center gap-2 text-sm text-[var(--nx-muted)]">
					<LayoutGrid size={15} /> No models match.
				</p>
			)}
		</div>
	);
}

function FilterChip(props: { active: boolean; onClick: () => void; label: string; iconUrl?: string | null }) {
	return (
		<button
			onClick={props.onClick}
			className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition ${
				props.active
					? 'border-indigo-500 bg-indigo-500/10 text-indigo-300'
					: 'border-[var(--nx-border)] text-[var(--nx-muted)] hover:text-zinc-200'
			}`}
		>
			{props.iconUrl && (
								// eslint-disable-next-line @next/next/no-img-element
				<img src={props.iconUrl} alt="" className="size-3.5 rounded-sm object-contain" />
			)}
			{props.label}
		</button>
	);
}
