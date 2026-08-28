import { useCallback, useEffect, useMemo, useState } from 'react';
import {
	Plus, Upload, Trash2, Building2, ChevronDown, ChevronRight,
	Search, X, Check,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { DashboardShell } from '../../components/DashboardShell';

interface Category {
	id: string;
	name: string;
	icon_url: string | null;
	sort_order: number;
}

interface ModelRow {
	id: string;
	upstream_model_id: string;
	display_name: string;
	category_id: string | null;
	enabled_for_users: boolean;
}

export default function AdminModels() {
	const [email, setEmail] = useState('');
	const [cats, setCats] = useState<Category[]>([]);
	const [models, setModels] = useState<ModelRow[]>([]);
	const [loading, setLoading] = useState(true);
	const [name, setName] = useState('');
	const [busy, setBusy] = useState(false);
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [assigning, setAssigning] = useState<Category | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		const { data: { user } } = await supabase.auth.getUser();
		setEmail(user?.email ?? '');
		const [{ data: catRows }, { data: modelRows }] = await Promise.all([
			supabase.from('model_categories').select('*').order('sort_order'),
			supabase
				.from('models')
				.select('id,upstream_model_id,display_name,category_id,enabled_for_users')
				.eq('enabled_for_users', true)
				.order('upstream_model_id'),
		]);
		setCats(catRows ?? []);
		setModels((modelRows ?? []) as ModelRow[]);
		setLoading(false);
	}, []);

	useEffect(() => { void load(); }, [load]);

	async function create() {
		if (!name.trim()) return;
		setBusy(true);
		await supabase.from('model_categories').insert({ name: name.trim(), sort_order: cats.length });
		setName('');
		await load();
		setBusy(false);
	}

	async function uploadIcon(catId: string, file: File) {
		setBusy(true);
		const ext = file.name.split('.').pop();
		const path = `categories/${catId}.${ext}`;
		await supabase.storage.from('public-media').upload(path, file, { upsert: true });
		const { data } = supabase.storage.from('public-media').getPublicUrl(path);
		await supabase.from('model_categories').update({ icon_url: data.publicUrl }).eq('id', catId);
		await load();
		setBusy(false);
	}

	async function remove(id: string) {
		await supabase.from('model_categories').delete().eq('id', id);
		await load();
	}

	/** Detach a single model from its category. */
	async function detachModel(modelId: string) {
		await supabase.from('models').update({ category_id: null }).eq('id', modelId);
		await load();
	}

	function toggleExpanded(id: string) {
		setExpanded((s) => {
			const next = new Set(s);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	/** models grouped by category id */
	const byCategory = useMemo(() => {
		const map: Record<string, ModelRow[]> = {};
		for (const m of models) {
			if (!m.category_id) continue;
			(map[m.category_id] ??= []).push(m);
		}
		return map;
	}, [models]);

	return (
		<DashboardShell variant="admin" email={email}>
			<div className="space-y-6">
				<header>
					<h1 className="font-display text-xl font-semibold tracking-tight">Models & Categories</h1>
					<p className="mt-0.5 text-sm text-[var(--nx-muted)]">
						Create company categories, then assign models into them. Assigned categories power the
						public catalog filters.
					</p>
				</header>

				{/* create */}
				<div className="flex flex-wrap gap-2">
					<input
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="New category name (e.g. Anthropic)"
						className="w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-cyan-500 sm:w-80"
					/>
					<button
						onClick={create}
						disabled={busy || !name.trim()}
						className="flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-40"
					>
						<Plus size={15} />
						Add category
					</button>
				</div>

				{loading ? (
					<div className="space-y-3" aria-busy="true">
						{Array.from({ length: 4 }).map((_, i) => <div key={i} className="nx-skeleton h-16 rounded-xl" />)}
					</div>
				) : (
					<div className="space-y-3">
						{cats.map((c) => {
							const members = byCategory[c.id] ?? [];
							const open = expanded.has(c.id);
							return (
								<section key={c.id} className="overflow-hidden rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)]">
									{/* header row */}
									<div className="flex flex-wrap items-center gap-3 px-5 py-3.5">
										<button onClick={() => toggleExpanded(c.id)} className="text-[var(--nx-muted)] hover:text-zinc-100" aria-label="Toggle">
											{open ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
										</button>
										{c.icon_url ? (
											<img src={c.icon_url} alt="" className="size-9 rounded-lg object-contain" />
										) : (
											<div className="grid size-9 place-items-center rounded-lg bg-zinc-800/60 text-[var(--nx-muted)]">
												<Building2 size={17} />
											</div>
										)}
										<div className="min-w-0 basis-full sm:flex-1 sm:basis-0">
											<p className="truncate font-medium">{c.name}</p>
											<p className="text-[11px] text-[var(--nx-muted)]">{members.length} model{members.length === 1 ? '' : 's'}</p>
										</div>

										<label className="flex cursor-pointer items-center gap-1 rounded-lg border border-[var(--nx-border)] px-2.5 py-1.5 text-[11px] text-cyan-400 hover:border-cyan-500/60">
											<Upload size={11} />
											{c.icon_url ? 'Icon' : 'Upload icon'}
											<input type="file" accept="image/*" className="hidden"
												onChange={(e) => e.target.files?.[0] && uploadIcon(c.id, e.target.files[0])} />
										</label>
										<button
											onClick={() => setAssigning(c)}
											className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-500"
										>
											<Plus size={12} />
											Add models
										</button>
										<button onClick={() => remove(c.id)} className="rounded-lg p-2 text-[var(--nx-muted)] hover:bg-red-500/10 hover:text-red-400" aria-label="Delete category">
											<Trash2 size={14} />
										</button>
									</div>

									{/* member list */}
									{open && members.length > 0 && (
										<ul className="divide-y divide-[var(--nx-border)] border-t border-[var(--nx-border)] bg-[var(--nx-bg-raised)]/40">
											{members.map((m) => (
												<li key={m.id} className="flex items-center gap-3 px-5 py-2 text-sm">
													<span className="min-w-0 flex-1 truncate text-xs">{m.display_name || m.upstream_model_id}</span>
													{m.enabled_for_users && (
														<span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-400">live</span>
													)}
													<button
														onClick={() => detachModel(m.id)}
														className="rounded p-1 text-[var(--nx-muted)] hover:bg-red-500/10 hover:text-red-400"
														title="Remove from this category"
													>
														<X size={13} />
													</button>
												</li>
											))}
										</ul>
									)}
								</section>
							);
						})}

						{cats.length === 0 && (
							<p className="rounded-xl border border-dashed border-[var(--nx-border)] py-14 text-center text-sm text-[var(--nx-muted)]">
								No categories yet — create your first one above.
							</p>
						)}
					</div>
				)}

				<p className="text-[11px] leading-relaxed text-[var(--nx-muted)]">
					A model belongs to at most one category. Removing a model from a category never disables it.
				</p>
			</div>

			{assigning && (
				<AssignModelsModal
					category={assigning}
					models={models}
					onClose={() => setAssigning(null)}
					onSaved={() => { setAssigning(null); void load(); }}
				/>
			)}
		</DashboardShell>
	);
}

/**
 * Two-pane picker: unassigned/other-category models on the left,
 * target category members on the right. Click to move either way.
 */
function AssignModelsModal({ category, models, onClose, onSaved }: {
	category: Category;
	models: ModelRow[];
	onClose: () => void;
	onSaved: () => void;
}) {
	const [query, setQuery] = useState('');
	const [pending, setPending] = useState<Record<string, boolean>>({}); // model_id -> in category?
	const [saving, setSaving] = useState(false);

	const currentIds = new Set(
		models.filter((m) => m.category_id === category.id).map((m) => m.id),
	);

	function isIn(m: ModelRow): boolean {
		return pending[m.id] ?? currentIds.has(m.id);
	}
	function toggle(id: string) {
		setPending((p) => ({ ...p, [id]: !isIn(models.find((x) => x.id === id)!) }));
	}

	const candidates = models.filter((m) => !isIn(m)).filter(
		(m) => {
			if (!query.trim()) return true;
			const q = query.toLowerCase();
			return m.upstream_model_id.toLowerCase().includes(q)
				|| (m.display_name?.toLowerCase().includes(q) ?? false);
		},
	);
	const chosen = models.filter((m) => isIn(m));

	async function save() {
		setSaving(true);
		for (const m of models) {
			const nowIn = pending[m.id];
			const wasIn = currentIds.has(m.id);
			if (nowIn === undefined || nowIn === wasIn) continue;
			await supabase.from('models')
				.update({ category_id: nowIn ? category.id : null })
				.eq('id', m.id);
		}
		setSaving(false);
		onSaved();
	}

	return (
		<div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
			<div className="flex h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-[var(--nx-border)] bg-[var(--nx-surface)] shadow-2xl">
				<header className="flex items-center justify-between border-b border-[var(--nx-border)] px-6 py-4">
					<h2 className="font-display font-semibold">Assign to {category.name}</h2>
					<button onClick={onClose} className="rounded-lg p-1.5 text-[var(--nx-muted)] hover:bg-zinc-800/60"><X size={18} /></button>
				</header>

				<div className="border-b border-[var(--nx-border)] px-6 py-3">
					<label className="relative block max-w-sm">
						<Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-[var(--nx-muted)]" />
						<input
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							placeholder="Filter catalog…"
							className="w-full rounded-lg border border-[var(--nx-border)] bg-transparent py-2 pe-3 ps-9 text-sm outline-none focus:border-cyan-500"
						/>
					</label>
				</div>

				<div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-6 pt-4 lg:grid-cols-2 lg:overflow-y-hidden">
					{/* available */}
					<section className="flex min-h-0 flex-col rounded-xl border border-[var(--nx-border)]">
						<h3 className="border-b border-[var(--nx-border)] px-4 py-2.5 text-sm font-medium">Catalog <span className="text-[var(--nx-muted)]">({candidates.length})</span></h3>
						<ul className="min-h-0 flex-1 divide-y divide-[var(--nx-border)] overflow-y-auto">
							{candidates.map((m) => (
								<li key={m.id}>
									<button onClick={() => toggle(m.id)} className="group flex w-full items-center justify-between gap-2 px-4 py-2 text-start text-sm hover:bg-cyan-500/5">
										<span className="truncate text-xs">{m.display_name || m.upstream_model_id}</span>
										<Plus size={13} className="shrink-0 text-[var(--nx-muted)] group-hover:text-cyan-400" />
									</button>
								</li>
							))}
						</ul>
					</section>

					{/* chosen */}
					<section className="flex min-h-0 flex-col rounded-xl border border-cyan-500/30">
						<h3 className="border-b border-[var(--nx-border)] px-4 py-2.5 text-sm font-medium">In {category.name} <span className="text-[var(--nx-muted)]">({chosen.length})</span></h3>
						<ul className="min-h-0 flex-1 divide-y divide-[var(--nx-border)] overflow-y-auto">
							{chosen.map((m) => (
								<li key={m.id}>
									<button onClick={() => toggle(m.id)} className="group flex w-full items-center justify-between gap-2 px-4 py-2 text-start text-sm hover:bg-red-500/5">
										<span className="truncate text-xs">{m.display_name || m.upstream_model_id}</span>
										<X size={13} className="shrink-0 text-[var(--nx-muted)] group-hover:text-red-400" />
									</button>
								</li>
							))}
						</ul>
					</section>
				</div>

				<footer className="flex justify-end gap-2 border-t border-[var(--nx-border)] px-6 py-4">
					<button onClick={onClose} className="rounded-lg border border-[var(--nx-border)] px-4 py-2 text-sm">Cancel</button>
					<button onClick={save} disabled={saving} className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-5 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-40">
						<Check size={14} />
						{saving ? 'Saving…' : 'Save assignment'}
					</button>
				</footer>
			</div>
		</div>
	);
}
