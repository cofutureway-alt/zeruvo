'use client';

import { useCallback, useEffect, useState } from 'react';
import { X, RefreshCw, ArrowRight, ArrowLeft, Check, AlertTriangle } from 'lucide-react';
import type { ProviderRow } from './providers-client';

interface ModelRow {
	id: string;
	upstream_model_id: string;
	display_name: string;
	usage_multiplier: string | number;
	enabled_for_users: boolean;
}

/**
 * Side-by-side selector per spec: chosen (live to users) on the right,
 * full upstream catalog on the left; click to move. Multiplier is
 * mandatory before saving.
 */
export function ModelSelector(props: { provider: ProviderRow; onClose: () => void }) {
	const [models, setModels] = useState<ModelRow[]>([]);
	const [loading, setLoading] = useState(true);
	const [syncing, setSyncing] = useState(false);
	const [saving, setSaving] = useState(false);
	const [multipliers, setMultipliers] = useState<Record<string, string>>({});
	const [error, setError] = useState<string | null>(null);
	const [justSynced, setJustSynced] = useState(false);

	const load = useCallback(async () => {
		setLoading(true);
		const admin = await import('@/lib/supabase/client').then((m) => m.createClient());
		const { data } = await admin
			.from('models')
			.select('id,upstream_model_id,display_name,usage_multiplier,enabled_for_users')
			.eq('provider_id', props.provider.id)
			.order('upstream_model_id');
		setModels((data ?? []) as ModelRow[]);
		const mults: Record<string, string> = {};
		for (const m of data ?? []) {
			mults[m.upstream_model_id] = String(Number(m.usage_multiplier) || 1);
		}
		setMultipliers(mults);
		setLoading(false);
	}, [props.provider.id]);

	useEffect(() => {
		void load();
	}, [load]);

	async function sync() {
		setSyncing(true);
		setError(null);
		const res = await fetch('/api/admin/models', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'sync', provider_id: props.provider.id }),
		});
		if (!res.ok) setError((await res.json()).error ?? 'Sync failed');
		else setJustSynced(true);
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
		// mandatory multiplier validation (>= 1)
		for (const s of selected) {
			if (!(s.usage_multiplier >= 1)) {
				setError(`Set a usage multiplier ≥ 1 for ${s.upstream_model_id}`);
				return;
			}
		}
		setSaving(true);
		setError(null);
		const res = await fetch('/api/admin/models', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				action: 'save_selection',
				provider_id: props.provider.id,
				selected,
			}),
		});
		if (!res.ok) setError((await res.json()).error ?? 'Save failed');
		else props.onClose();
		setSaving(false);
	}

	function toggle(id: string) {
		setModels((ms) =>
			ms.map((m) => (m.id === id ? { ...m, enabled_for_users: !m.enabled_for_users } : m)),
		);
	}

	const live = models.filter((m) => m.enabled_for_users);
	const available = models.filter((m) => !m.enabled_for_users);

	return (
		<div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
			<div className="flex h-[85vh] w-full max-w-5xl flex-col rounded-2xl border border-[var(--nx-border)] bg-[var(--nx-surface)] shadow-2xl">
				<header className="flex items-center justify-between border-b border-[var(--nx-border)] px-6 py-4">
					<div>
						<h2 className="font-semibold">{props.provider.display_name} — models</h2>
						<p className="text-xs text-[var(--nx-muted)]">
							Click a model to move it between catalog and live list.
						</p>
					</div>
					<div className="flex items-center gap-2">
						<button
							onClick={sync}
							disabled={syncing}
							className="flex items-center gap-2 rounded-lg border border-[var(--nx-border)] px-3 py-2 text-sm hover:border-indigo-500/50 disabled:opacity-40"
						>
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
				{justSynced && !error && (
					<p className="mx-6 mt-3 flex items-center gap-2 text-sm text-emerald-400">
						<Check size={15} /> Catalog synced — pick the models you want to expose.
					</p>
				)}

				<div className="grid min-h-0 flex-1 grid-cols-2 gap-4 p-6 pt-4">
					{/* available */}
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
										<button
											onClick={() => toggle(m.id)}
											className="group flex w-full items-center justify-between gap-3 px-4 py-2.5 text-start text-sm hover:bg-indigo-500/5"
										>
											<span className="truncate">{m.upstream_model_id}</span>
											<ArrowRight size={15} className="shrink-0 text-[var(--nx-muted)] group-hover:text-indigo-400" />
										</button>
									</li>
								))
							)}
						</ul>
					</section>

					{/* chosen + multiplier */}
					<section className="flex min-h-0 flex-col rounded-xl border border-indigo-500/30">
						<h3 className="border-b border-[var(--nx-border)] px-4 py-2.5 text-sm font-medium">
							Live to users{' '}
							<span className="text-[var(--nx-muted)]">({live.length})</span>
							<span className="ms-1 text-[11px] text-red-400">multiplier required</span>
						</h3>
						<ul className="min-h-0 flex-1 divide-y divide-[var(--nx-border)] overflow-y-auto">
							{live.length === 0 ? (
								<li className="px-4 py-6 text-sm text-[var(--nx-muted)]">Nothing exposed yet.</li>
							) : (
								live.map((m) => (
									<li key={m.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
										<button
											onClick={() => toggle(m.id)}
											className="group flex min-w-0 flex-1 items-center gap-3 text-start"
										>
											<ArrowLeft size={15} className="shrink-0 text-[var(--nx-muted)] group-hover:text-red-400" />
											<span className="truncate">{m.upstream_model_id}</span>
										</button>
										<label className="flex shrink-0 items-center gap-1.5 text-xs text-[var(--nx-muted)]">
											×
											<input
												type="number"
												min={1}
												step="any"
												value={multipliers[m.upstream_model_id] ?? '1'}
												onChange={(e) =>
													setMultipliers({ ...multipliers, [m.upstream_model_id]: e.target.value })
												}
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
					<p className="text-xs text-[var(--nx-muted)]">
						Weighted billing: a ×50 model consumes 50 quota units per token.
					</p>
					<div className="flex gap-2">
						<button onClick={props.onClose} className="rounded-lg border border-[var(--nx-border)] px-4 py-2 text-sm">
							Cancel
						</button>
						<button
							onClick={save}
							disabled={saving}
							className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
						>
							{saving ? 'Saving…' : `Save ${live.length} model${live.length === 1 ? '' : 's'}`}
						</button>
					</div>
				</footer>
			</div>
		</div>
	);
}
