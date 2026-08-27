import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Check } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { DashboardShell } from '../../components/DashboardShell';

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
	plan_models?: Array<{ model_id: string }>;
}

const LOCALES = ['en', 'ar', 'fr', 'zh'] as const;

export default function AdminPlans() {
	const [email, setEmail] = useState('');
	const [plans, setPlans] = useState<PlanRow[]>([]);
	const [models, setModels] = useState<Array<{ id: string; upstream_model_id: string }>>([]);
	const [editing, setEditing] = useState<PlanRow | 'new' | null>(null);

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

	return (
		<DashboardShell variant="admin" email={email}>
			<div className="space-y-6">
				<header className="flex items-center justify-between">
					<div>
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
								{p.default_free && <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-400">default free</span>}
							</div>
							<div className="mt-4 flex items-baseline gap-1">
								<span className="text-2xl font-semibold tabular-nums">${Number(p.price_usd).toFixed(2)}</span>
								<span className="text-xs text-[var(--nx-muted)]">/ {p.duration_count} {p.duration_unit}</span>
							</div>
							<p className="mt-2 text-sm tabular-nums text-[var(--nx-muted)]">{Number(p.daily_weighted_tokens).toLocaleString()} weighted tokens / day</p>
							<p className="mt-1 text-xs text-[var(--nx-muted)]">{(p.plan_models ?? []).length} models included</p>
							<button onClick={() => setEditing(p)} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--nx-border)] py-2 text-sm hover:border-cyan-500/50 hover:text-cyan-300">
								<Pencil size={14} />
								Edit
							</button>
						</article>
					))}
				</div>

				{editing && <PlanEditor initial={editing === 'new' ? null : editing} models={models} onClose={() => { setEditing(null); void load(); }} />}
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
			active: true,
		};

		let planId = p?.id;
		if (planId) {
			if (isDefault) await supabase.from('plans').update({ default_free: false }).neq('id', planId);
			await supabase.from('plans').update(row).eq('id', planId);
			await supabase.from('plan_models').delete().eq('plan_id', planId);
		} else {
			if (isDefault) await supabase.from('plans').update({ default_free: false }).eq('default_free', true);
			const { data } = await supabase.from('plans').insert(row).select().single();
			planId = data?.id;
		}
		if (planId && selected.size) {
			await supabase.from('plan_models').insert([...selected].map((model_id) => ({ plan_id: planId!, model_id })));
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
					<div className="grid grid-cols-2 gap-3">
						{LOCALES.map((l) => (
							<div key={l} className="space-y-1.5">
								<input value={name[l] ?? ''} onChange={(e) => setName({ ...name, [l]: e.target.value })} placeholder={`Name (${l})${l === 'en' ? ' — required' : ''}`} className="w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-cyan-500" />
								<input value={description[l] ?? ''} onChange={(e) => setDescription({ ...description, [l]: e.target.value })} placeholder={`Description (${l})`} className="w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-xs outline-none focus:border-cyan-500" />
							</div>
						))}
					</div>

					<div className="grid grid-cols-2 gap-3">
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

					<div className="flex gap-5">
						<label className="flex items-center gap-2 text-sm">
							<input type="checkbox" checked={isFree} onChange={(e) => setIsFree(e.target.checked)} />
							Free plan
						</label>
						<label className={`flex items-center gap-2 text-sm ${!isFree && 'opacity-40'}`}>
							<input type="checkbox" disabled={!isFree} checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
							Default for new signups
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
