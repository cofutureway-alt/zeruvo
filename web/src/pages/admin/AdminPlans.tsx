import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Check, Eye, EyeOff, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { DashboardShell } from '../../components/DashboardShell';
import { ConfirmModal } from './Providers';

interface PlanRow {
	id: string;
	name: Record<string, string>;
	description: Record<string, string>;
	daily_weighted_tokens: number | string;
	price_usd: number | string;
	duration_unit: 'days' | 'months' | 'years';
	duration_count: number;
	is_free: boolean;
	default_free: boolean;
	active: boolean;
	renewable: boolean;
	plan_models?: Array<{ model_id: string }>;
}

const LOCALES = ['en', 'ar', 'fr', 'zh'] as const;

export default function AdminPlans() {
	const [email, setEmail] = useState('');
	const [plans, setPlans] = useState<PlanRow[]>([]);
	const [models, setModels] = useState<Array<{ id: string; upstream_model_id: string }>>([]);
	const [editing, setEditing] = useState<PlanRow | 'new' | null>(null);
	const [deleting, setDeleting] = useState<PlanRow | null>(null);
	const [togglingId, setTogglingId] = useState<string | null>(null);

	const load = useCallback(async () => {
		const { data: { user } } = await supabase.auth.getUser();
		setEmail(user?.email ?? '');
		const [{ data: plansData }, { data: modelsData }] = await Promise.all([
			supabase.from('plans').select('*, plan_models(model_id)').order('price_usd'),
			supabase.from('models').select('id,upstream_model_id').eq('enabled_for_users', true).order('upstream_model_id'),
		]);
		setPlans(
			(plansData ?? []).map((p: PlanRow & { plan_models?: Array<{ model_id: string }> | null }) => ({
				...p,
				model_ids: p.plan_models?.map((pm) => pm.model_id) ?? [],
			})),
		);
		setModels(modelsData ?? []);
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	async function toggleActive(p: PlanRow) {
		setTogglingId(p.id);
		await supabase.from('plans').update({ active: !p.active }).eq('id', p.id);
		setTogglingId(null);
		await load();
	}

	async function doDelete() {
		if (!deleting) return;
		const id = deleting.id;
		setDeleting(null);
		// Soft-delete: hide from the catalog. Current subscribers keep their
		// subscription (quota continues) and can still renew per `renewable`.
		await supabase.from('plans').update({ active: false }).eq('id', id);
		await load();
	}

	return (
		<DashboardShell variant="admin" email={email}>
			<div className="space-y-6">
				<header className="flex flex-wrap items-center justify-between gap-3">
					<div className="min-w-0">
						<h1 className="text-xl font-semibold tracking-tight">Plans</h1>
						<p className="mt-0.5 text-sm text-[var(--nx-muted)]">Subscription tiers with daily weighted-token allowances.</p>
					</div>
					<button onClick={() => setEditing('new')} className="flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500">
						<Plus size={16} />
						New plan
					</button>
				</header>

				<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
					{plans.map((p) => (
						<article key={p.id} className="rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-5">
							<div className="flex items-start justify-between">
								<div className="min-w-0">
									<h3 className="truncate font-medium">{p.name.en}</h3>
									<p className="truncate text-xs text-[var(--nx-muted)]">{p.description?.en ?? ''}</p>
								</div>
								<div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
									{p.default_free && <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-400">default free</span>}
									{!p.active && <span className="rounded-full bg-zinc-700/40 px-2 py-0.5 text-[11px] text-zinc-400">hidden</span>}
									{!p.renewable && <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-400">renewal off</span>}
								</div>
							</div>
							<div className="mt-4 flex items-baseline gap-1">
								<span className="text-2xl font-semibold tabular-nums">${Number(p.price_usd).toFixed(2)}</span>
								<span className="text-xs text-[var(--nx-muted)]">/ {p.duration_count} {p.duration_unit}</span>
							</div>
							<p className="mt-2 text-sm tabular-nums text-[var(--nx-muted)]">{Number(p.daily_weighted_tokens).toLocaleString()} weighted tokens / day</p>
							<p className="mt-1 text-xs text-[var(--nx-muted)]">{(p.plan_models ?? []).length} models included</p>
							<div className="mt-4 grid grid-cols-2 gap-2">
								<button
									onClick={() => setEditing(p)}
									className="flex items-center justify-center gap-2 rounded-lg border border-[var(--nx-border)] py-2 text-sm hover:border-cyan-500/50 hover:text-cyan-300"
								>
									<Pencil size={14} />
									Edit
								</button>
								<button
									onClick={() => toggleActive(p)}
									disabled={togglingId === p.id}
									className={`flex items-center justify-center gap-2 rounded-lg border py-2 text-sm transition disabled:opacity-40 ${p.active ? 'border-[var(--nx-border)] hover:border-amber-500/50 hover:text-amber-300' : 'border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/5'}`}
									title={p.active ? 'Hide from users' : 'Show to users'}
								>
									{p.active ? <EyeOff size={14} /> : <Eye size={14} />}
									{p.active ? 'Hide' : 'Show'}
								</button>
								<button
									onClick={() => setDeleting(p)}
									className="col-span-2 flex items-center justify-center gap-2 rounded-lg border border-red-500/30 py-2 text-sm text-red-400 hover:bg-red-500/10"
								>
									<Trash2 size={14} />
									Delete
								</button>
							</div>
						</article>
					))}
				</div>

				{editing && <PlanEditor initial={editing === 'new' ? null : editing} models={models} onClose={() => { setEditing(null); void load(); }} />}
				{deleting && (
					<ConfirmModal
						title={`Delete ${deleting.name.en}?`}
						body="This removes the plan from the user catalog. Current subscribers are NOT affected until their subscription expires, and they can still renew if renewals are enabled for this plan."
						confirmLabel="Hide plan"
						onCancel={() => setDeleting(null)}
						onConfirm={doDelete}
					/>
				)}
			</div>
		</DashboardShell>
	);
}

function PlanEditor(props: { initial: PlanRow | null; models: Array<{ id: string; upstream_model_id: string }>; onClose: () => void }) {
	const p = props.initial;
	const [name, setName] = useState<Record<string, string>>(p?.name ?? { en: '', ar: '', fr: '', zh: '' });
	const [description, setDescription] = useState<Record<string, string>>(p?.description ?? { en: '', ar: '', fr: '', zh: '' });
	const [tokens, setTokens] = useState(String(Number(p?.daily_weighted_tokens ?? 1_000_000)));
	const [price, setPrice] = useState(String(Number(p?.price_usd ?? 15)));
	const [unit, setUnit] = useState<PlanRow['duration_unit']>(p?.duration_unit ?? 'days');
	const [count, setCount] = useState(String(p?.duration_count ?? 30));
	const [isFree, setIsFree] = useState(p?.is_free ?? false);
	const [isDefault, setIsDefault] = useState(p?.default_free ?? false);
	const [renewable, setRenewable] = useState(p?.renewable ?? true);
	const [selected, setSelected] = useState<Set<string>>(new Set((p?.plan_models ?? []).map((pm) => pm.model_id)));
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function save() {
		if (!name.en.trim()) return setError('English name is required');
		setBusy(true);
		setError(null);

		const row = {
			name,
			description,
			daily_weighted_tokens: Number(tokens),
			price_usd: isFree ? 0 : Number(price),
			duration_unit: unit,
			duration_count: Number(count),
			is_free: isFree,
			default_free: isFree && isDefault,
			active: p?.active ?? true,
			renewable,
		};

		let planId = p?.id;
		if (planId) {
			if (isDefault) {
				const { error: e } = await supabase.from('plans').update({ default_free: false }).neq('id', planId);
				if (e) { setError(e.message); setBusy(false); return; }
			}
			const { error: e } = await supabase.from('plans').update(row).eq('id', planId);
			if (e) { setError(e.message); setBusy(false); return; }
			const { error: de } = await supabase.from('plan_models').delete().eq('plan_id', planId);
			if (de) { setError(de.message); setBusy(false); return; }
		} else {
			if (isDefault) {
				const { error: e } = await supabase.from('plans').update({ default_free: false }).eq('default_free', true);
				if (e) { setError(e.message); setBusy(false); return; }
			}
			const { data, error: e } = await supabase.from('plans').insert(row).select().single();
			if (e) { setError(e.message); setBusy(false); return; }
			if (!data) { setError('Insert returned no row — plan not created.'); setBusy(false); return; }
			planId = data.id;
		}
		if (planId && selected.size) {
			const { error: pe } = await supabase.from('plan_models').insert([...selected].map((model_id) => ({ plan_id: planId!, model_id })));
			if (pe) { setError(pe.message); setBusy(false); return; }
		}
		props.onClose();
	}

	function toggleModel(id: string) {
		setSelected((s) => {
			const next = new Set(s);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	return (
		<div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm">
			<div className="w-full max-w-2xl rounded-2xl border border-[var(--nx-border)] bg-[var(--nx-surface)] shadow-2xl">
				<header className="border-b border-[var(--nx-border)] px-6 py-4">
					<h2 className="font-semibold">{p ? 'Edit plan' : 'New plan'}</h2>
				</header>

				<div className="max-h-[70vh] space-y-5 overflow-y-auto p-6">
					<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
						{LOCALES.map((l) => (
							<div key={l} className="space-y-1.5">
								<input value={name[l] ?? ''} onChange={(e) => setName({ ...name, [l]: e.target.value })} placeholder={`Name (${l})${l === 'en' ? ' — required' : ''}`} className="w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-cyan-500" />
								<input value={description[l] ?? ''} onChange={(e) => setDescription({ ...description, [l]: e.target.value })} placeholder={`Description (${l})`} className="w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-xs outline-none focus:border-cyan-500" />
							</div>
						))}
					</div>

					<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
						<label className="block">
							<span className="text-sm text-[var(--nx-muted)]">Daily weighted tokens</span>
							<input type="number" min={1} value={tokens} onChange={(e) => setTokens(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm tabular-nums outline-none focus:border-cyan-500" />
						</label>
						<label className="block">
							<span className="text-sm text-[var(--nx-muted)]">Price USD {isFree && '(free)'}</span>
							<input type="number" min={0} step="0.01" disabled={isFree} value={price} onChange={(e) => setPrice(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm tabular-nums outline-none focus:border-cyan-500 disabled:opacity-40" />
						</label>
						<label className="block">
							<span className="text-sm text-[var(--nx-muted)]">Duration count</span>
							<input type="number" min={1} value={count} onChange={(e) => setCount(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm tabular-nums outline-none focus:border-cyan-500" />
						</label>
						<label className="block">
							<span className="text-sm text-[var(--nx-muted)]">Duration unit</span>
							<select value={unit} onChange={(e) => setUnit(e.target.value as typeof unit)} className="mt-1 w-full rounded-lg border border-[var(--nx-border)] bg-[var(--nx-surface)] px-3 py-2 text-sm outline-none focus:border-cyan-500">
								<option value="days">Days</option>
								<option value="months">Months</option>
								<option value="years">Years</option>
							</select>
						</label>
					</div>

					<div className="flex flex-wrap items-center gap-x-5 gap-y-2">
						<label className="flex items-center gap-2 text-sm">
							<input type="checkbox" checked={isFree} onChange={(e) => setIsFree(e.target.checked)} />
							Free plan
						</label>
						<label className={`flex items-center gap-2 text-sm ${!isFree && 'opacity-40'}`}>
							<input type="checkbox" disabled={!isFree} checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
							Default for new signups
						</label>
						<label className="flex items-center gap-2 text-sm">
							<input type="checkbox" checked={renewable} onChange={(e) => setRenewable(e.target.checked)} />
							Allow renewal for current subscribers
						</label>
					</div>

					<div>
						<p className="mb-2 text-sm font-medium">Included models <span className="font-normal text-[var(--nx-muted)]">({selected.size})</span></p>
						<div className="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-[var(--nx-border)] p-2">
							{props.models.map((m) => (
								<button key={m.id} onClick={() => toggleModel(m.id)} className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-start text-sm hover:bg-cyan-500/5">
									<span className={`grid size-4 shrink-0 place-items-center rounded border ${selected.has(m.id) ? 'border-cyan-500 bg-cyan-600 text-white' : 'border-[var(--nx-border)]'}`}>
										{selected.has(m.id) && <Check size={11} />}
									</span>
									<span className="truncate">{m.upstream_model_id}</span>
								</button>
							))}
						</div>
					</div>

					{error && <p className="text-sm text-red-400">{error}</p>}
				</div>

				<footer className="flex justify-end gap-2 border-t border-[var(--nx-border)] px-6 py-4">
					<button onClick={props.onClose} className="rounded-lg border border-[var(--nx-border)] px-4 py-2 text-sm">Cancel</button>
					<button onClick={save} disabled={busy} className="rounded-lg bg-cyan-600 px-5 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-40">
						{busy ? 'Saving…' : p ? 'Update plan' : 'Create plan'}
					</button>
				</footer>
			</div>
		</div>
	);
}
