import { useCallback, useEffect, useState } from 'react';
import { X, RefreshCw, ArrowRight, ArrowLeft, Check, AlertTriangle, Search, Plus } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { ProviderRow } from '../../pages/admin/Providers';

interface ModelRow {
	id: string;
	upstream_model_id: string;
	display_name: string;
	usage_multiplier: string | number;
	enabled_for_users: boolean;
	slug?: string;
}

/** Side-by-side catalog picker with mandatory multiplier (Phase 3 port). */
export function ModelSelector(props: { provider: ProviderRow; onClose: () => void }) {
	const [models, setModels] = useState<ModelRow[]>([]);
	const [loading, setLoading] = useState(true);
	const [syncing, setSyncing] = useState(false);
	const [saving, setSaving] = useState(false);
	const [multipliers, setMultipliers] = useState<Record<string, string>>({});
	const [names, setNames] = useState<Record<string, string>>({});
	const [query, setQuery] = useState('');
	const [newId, setNewId] = useState('');
	const [adding, setAdding] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		const { data } = await supabase
			.from('models')
			.select('id,upstream_model_id,display_name,usage_multiplier,enabled_for_users,slug')
			.eq('provider_id', props.provider.id)
			.order('upstream_model_id');
		setModels((data ?? []) as ModelRow[]);
		const mults: Record<string, string> = {};
		const nms: Record<string, string> = {};
		for (const m of data ?? []) {
			mults[m.upstream_model_id] = String(Number(m.usage_multiplier) || 1);
			if (m.display_name) nms[m.id] = m.display_name;
		}
		setMultipliers(mults);
		setNames(nms);
		setLoading(false);
	}, [props.provider.id]);

	useEffect(() => {
		void load();
	}, [load]);

	async function sync() {
		setSyncing(true);
		setError(null);
		try {
			const functionsUrl = import.meta.env.VITE_SUPABASE_URL.replace('.supabase.co', '.functions.supabase.co');
			const { data: { session } } = await supabase.auth.getSession();
			const res = await fetch(`${functionsUrl}/admin-sync-models`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${session?.access_token ?? ''}`,
					apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
				},
				body: JSON.stringify({ provider_id: props.provider.id }),
			});
			const body = await res.json().catch(() => null);
			if (!res.ok) { setError(body?.error ?? 'Sync failed'); setSyncing(false); return; }
			if (body?.synced > 0 && body?.added === 0 && body?.updated_meta === 0) {
				setError(`Synced ${body.synced} upstream model(s) but none were new. ${body.note ?? ''}`);
			}
		} catch {
			setError('Sync failed');
		}
		setSyncing(false);
		await load();
	}

	async function save() {
		const selected = models
			.filter((m) => m.enabled_for_users)
			.map((m) => ({
				upstream_model_id: m.upstream_model_id,
				usage_multiplier: Number(multipliers[m.upstream_model_id] ?? 1),
			}));
		for (const s of selected) {
			if (!(s.usage_multiplier >= 1)) {
				setError(`Set a usage multiplier ≥ 1 for ${s.upstream_model_id}`);
				return;
			}
		}
		setSaving(true);
		setError(null);
		for (const m of models) {
			const mult = Number(multipliers[m.upstream_model_id] ?? 1) || 1;
			await supabase
				.from('models')
				.update({
					enabled_for_users: m.enabled_for_users,
					usage_multiplier: mult,
					display_name: names[m.id]?.trim() || m.upstream_model_id,
				})
				.eq('id', m.id);
		}
		props.onClose();
		setSaving(false);
	}

	function toggle(id: string) {
		setModels((ms) => ms.map((m) => (m.id === id ? { ...m, enabled_for_users: !m.enabled_for_users } : m)));
	}

	const q = query.toLowerCase();
	const live = models.filter((m) => m.enabled_for_users && (!q || m.upstream_model_id.toLowerCase().includes(q) || m.display_name?.toLowerCase().includes(q)));
	const available = models.filter((m) => !m.enabled_for_users && (!q || m.upstream_model_id.toLowerCase().includes(q) || m.display_name?.toLowerCase().includes(q)));

	async function addCustom() {
		const raw = newId.trim();
		if (!raw) return;
		setAdding(true); setError(null);
		// slug is globally unique across all providers (models_slug_key). A
		// different provider, or another id sanitizing to the same string, may
		// already hold it — so probe the DB and suffix until free.
		let slug = raw.replace(/[^a-zA-Z0-9._:-]/g, '-').replace(/^-+/, '');
		let candidate = slug;
		for (let i = 2; ; i++) {
			const { data: clash } = await supabase.from('models').select('id').eq('slug', candidate).maybeSingle();
			if (!clash) { slug = candidate; break; }
			candidate = `${slug}-${i}`;
		}
		const { error: insErr } = await supabase.from('models').insert({
			provider_id: props.provider.id,
			upstream_model_id: raw,
			display_name: raw,
			slug,
			enabled_for_users: true,
			usage_multiplier: 1,
		});
		if (insErr?.code === '23505' && insErr.message.includes('models_slug_key')) {
			// race with a concurrent insert: retry with a random suffix
			const { error: retryErr } = await supabase.from('models').insert({
				provider_id: props.provider.id,
				upstream_model_id: raw,
				display_name: raw,
				slug: `${slug}-${Array.from(crypto.getRandomValues(new Uint32Array(1)))[0].toString(36)}`,
				enabled_for_users: true,
				usage_multiplier: 1,
			});
			if (retryErr) { setError(retryErr.message); setAdding(false); return; }
		} else if (insErr) {
			setError(insErr.message);
			setAdding(false);
			return;
		}
		setNewId('');
		setAdding(false);
		await load();
	}

	return (
		<div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
			<div className="flex h-[85vh] w-full max-w-5xl flex-col rounded-2xl border border-[var(--nx-border)] bg-[var(--nx-surface)] shadow-2xl">
				<header className="flex items-center justify-between border-b border-[var(--nx-border)] px-6 py-4">
					<div>
						<h2 className="font-semibold">{props.provider.display_name} — models</h2>
						<p className="text-xs text-[var(--nx-muted)]">Click a model to move it between catalog and live list.</p>
					</div>
					<div className="flex items-center gap-2">
						<button onClick={sync} disabled={syncing} className="flex items-center gap-2 rounded-lg border border-[var(--nx-border)] px-3 py-2 text-sm hover:border-cyan-500/50 disabled:opacity-40">
							<RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />
							Sync
						</button>
						<button onClick={props.onClose} className="rounded-lg p-1.5 text-[var(--nx-muted)] hover:bg-zinc-800/60">
							<X size={18} />
						</button>
					</div>
				</header>

				{error && (
					<div className="mx-6 mt-3 flex items-center gap-2 rounded-lg bg-red-500/10 px-4 py-2.5 text-sm text-red-400">
						<AlertTriangle size={15} />
						{error}
					</div>
				)}

				{/* search + add custom */}
				<div className="flex flex-wrap items-center gap-2 px-6 pt-4">
					<label className="relative block flex-1 min-w-48">
						<Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-[var(--nx-muted)]" />
						<input
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							placeholder="Search models…"
							className="w-full rounded-lg border border-[var(--nx-border)] bg-transparent py-2 pe-3 ps-9 text-sm outline-none focus:border-cyan-500"
						/>
					</label>
					<input
						value={newId}
						onChange={(e) => setNewId(e.target.value)}
						onKeyDown={(e) => { if (e.key === 'Enter') void addCustom(); }}
						placeholder="Add custom model id (e.g. org/model)"
						dir="ltr"
						className="w-72 min-w-48 max-w-xs flex-1 rounded-lg border border-dashed border-[var(--nx-border)] bg-transparent px-3 py-2 font-mono text-xs outline-none focus:border-cyan-500"
					/>
					<button
						onClick={() => void addCustom()}
						disabled={adding || !newId.trim()}
						className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-40"
					>
						<Plus size={14} />
						{adding ? 'Adding…' : 'Add model'}
					</button>
				</div>

				<div className="grid min-h-0 flex-1 grid-cols-2 gap-4 p-6 pt-4">
					<section className="flex min-h-0 flex-col rounded-xl border border-[var(--nx-border)]">
						<h3 className="border-b border-[var(--nx-border)] px-4 py-2.5 text-sm font-medium">
							Catalog <span className="text-[var(--nx-muted)]">({available.length})</span>
						</h3>
						<ul className="min-h-0 flex-1 divide-y divide-[var(--nx-border)] overflow-y-auto">
							{loading ? (
								<li className="px-4 py-6 text-sm text-[var(--nx-muted)]">Loading…</li>
							) : available.length === 0 ? (
								<li className="px-4 py-6 text-sm text-[var(--nx-muted)]">All models are live.</li>
							) : (
								available.map((m) => (
									<li key={m.id}>
										<button onClick={() => toggle(m.id)} className="group flex w-full items-center justify-between gap-3 px-4 py-2.5 text-start text-sm hover:bg-cyan-500/5">
											<div className="min-w-0 truncate">
												<span>{m.upstream_model_id}</span>
												{names[m.id] && (
													<span className="ms-2 text-xs text-[var(--nx-muted)]">→ {names[m.id]}</span>
												)}
											</div>
											<ArrowRight size={15} className="shrink-0 text-[var(--nx-muted)] group-hover:text-cyan-400" />
										</button>
									</li>
								))
							)}
						</ul>
					</section>

					<section className="flex min-h-0 flex-col rounded-xl border border-cyan-500/30">
						<h3 className="border-b border-[var(--nx-border)] px-4 py-2.5 text-sm font-medium">
							Live to users <span className="text-[var(--nx-muted)]">({live.length})</span>
							<span className="ms-1 text-[11px] text-red-400">multiplier required</span>
						</h3>
						<ul className="min-h-0 flex-1 divide-y divide-[var(--nx-border)] overflow-y-auto">
							{live.length === 0 ? (
								<li className="px-4 py-6 text-sm text-[var(--nx-muted)]">Nothing exposed yet.</li>
							) : (
								live.map((m) => (
									<li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 text-sm">
										<button onClick={() => toggle(m.id)} className="group flex min-w-0 basis-40 flex-1 items-center gap-3 text-start">
											<ArrowLeft size={15} className="shrink-0 text-[var(--nx-muted)] group-hover:text-red-400" />
											<div className="min-w-0">
												<p className="truncate">{m.display_name || m.upstream_model_id}</p>
												{m.display_name && m.display_name !== m.upstream_model_id && (
													<p className="truncate font-mono text-[10px] text-[var(--nx-muted)]">{m.upstream_model_id}</p>
												)}
											</div>
										</button>
										<input
											type="text"
											value={names[m.id] ?? m.upstream_model_id}
											onChange={(e) => setNames({ ...names, [m.id]: e.target.value })}
											placeholder="Custom name"
											title="Custom name shown to users"
											className="w-36 shrink-0 rounded-md border border-[var(--nx-border)] bg-transparent px-2 py-1 text-xs outline-none focus:border-cyan-500"
										/>
										<label className="flex shrink-0 items-center gap-1.5 text-xs text-[var(--nx-muted)]">
											×
											<input
												type="number"
												min={1}
												step="any"
												value={multipliers[m.upstream_model_id] ?? '1'}
												onChange={(e) => setMultipliers({ ...multipliers, [m.upstream_model_id]: e.target.value })}
												className={`w-16 rounded-md border bg-transparent px-2 py-1 text-end tabular-nums outline-none ${
													multipliers[m.upstream_model_id] === '' || Number(multipliers[m.upstream_model_id]) < 1
														? 'border-red-500'
														: 'border-[var(--nx-border)]'
												}`}
											/>
										</label>
									</li>
								))
							)}
						</ul>
					</section>
				</div>

				<footer className="flex items-center justify-between border-t border-[var(--nx-border)] px-6 py-4">
					<p className="text-xs text-[var(--nx-muted)]">Weighted billing: a ×50 model consumes 50 quota units per token.</p>
					<div className="flex gap-2">
						<button onClick={props.onClose} className="rounded-lg border border-[var(--nx-border)] px-4 py-2 text-sm">Cancel</button>
						<button onClick={save} disabled={saving} className="rounded-lg bg-cyan-600 px-5 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-40">
							{saving ? 'Saving…' : `Save ${live.length} model${live.length === 1 ? '' : 's'}`}
						</button>
					</div>
				</footer>
			</div>
		</div>
	);
}
