import { useCallback, useEffect, useMemo, useState } from 'react';
import { Gift, Plus, Pencil, Trash2, Power, X, Search, Users } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { DashboardShell } from '../../components/DashboardShell';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useAppSettings } from '../../hooks/useAppSettings';
import { PageHeader, Pill } from '../../components/console-kit';

interface OfferRow {
	id: string;
	name: string;
	amount_usd: number;
	model_ids: string[];
	audience: 'new_users' | 'plan_subscribers' | 'topped_up';
	audience_plan_id: string | null;
	new_user_days: number;
	require_topup_usd: number | null;
	expires_days: number | null;
	max_claims: number | null;
	active: boolean;
	valid_from: string;
	valid_to: string | null;
	created_at: string;
}

interface PickModel {
	id: string;
	display_name: string;
	vendor_slug: string | null;
}

interface PlanRow {
	id: string;
	name: { en?: string; ar?: string } | null;
	active: boolean;
}

const AUDIENCE_LABEL: Record<OfferRow['audience'], string> = {
	new_users: 'New users',
	plan_subscribers: 'Plan subscribers',
	topped_up: 'Topped up before',
};

export default function CreditOffers() {
	const settings = useAppSettings();
	const [email, setEmail] = useState('');
	const [offers, setOffers] = useState<OfferRow[]>([]);
	const [claims, setClaims] = useState<Record<string, number>>({});
	const [plans, setPlans] = useState<PlanRow[]>([]);
	const [loading, setLoading] = useState(true);
	const [modal, setModal] = useState<{ kind: 'edit'; offer: OfferRow | null } | null>(null);
	const [confirmOffer, setConfirmOffer] = useState<OfferRow | null>(null);
	const [deleting, setDeleting] = useState(false);
	const [deleteError, setDeleteError] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		const { data: { user } } = await supabase.auth.getUser();
		if (user) setEmail(user.email ?? '');
		const [oq, cq, pq] = await Promise.all([
			supabase.from('credit_offers').select('*').order('created_at', { ascending: false }),
			supabase.from('credit_offer_claims').select('offer_id'),
			supabase.from('plans').select('id,name,active').order('price_usd'),
		]);
		setOffers((oq.data ?? []) as OfferRow[]);
		const counts: Record<string, number> = {};
		for (const r of (cq.data ?? []) as { offer_id: string }[]) {
			counts[r.offer_id] = (counts[r.offer_id] ?? 0) + 1;
		}
		setClaims(counts);
		setPlans((pq.data ?? []) as PlanRow[]);
		setLoading(false);
	}, []);

	useEffect(() => { void load(); }, [load]);

	async function toggleActive(o: OfferRow) {
		await supabase.from('credit_offers').update({ active: !o.active }).eq('id', o.id);
		await load();
	}

	async function destroyOffer() {
		if (!confirmOffer) return;
		setDeleting(true);
		setDeleteError(null);
		const { error } = await supabase.from('credit_offers').delete().eq('id', confirmOffer.id);
		setDeleting(false);
		if (error) { setDeleteError(error.message); return; }
		setConfirmOffer(null);
		await load();
	}

	const minTopup = Number(settings?.wallet_min_topup_usd ?? 10);

	return (
		<DashboardShell variant="admin" email={email}>
			<div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<PageHeader
						title="Free Credit Offers"
						subtitle="Grant wallet credit that only works on the models you choose — targeted at new users, plan subscribers or users who topped up."
					/>
					<button
						onClick={() => setModal({ kind: 'edit', offer: null })}
						className="flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500"
					>
						<Plus size={15} /> New offer
					</button>
				</div>

				<div className="mt-6 overflow-hidden rounded-2xl border border-[var(--nx-border)] bg-[var(--nx-surface)]">
					{loading ? (
						<p className="px-4 py-10 text-center text-sm text-[var(--nx-muted)]">Loading…</p>
					) : offers.length === 0 ? (
						<p className="px-4 py-10 text-center text-sm text-[var(--nx-muted)]">
							No offers yet — create one to give selected users free credit.
						</p>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full text-sm">
								<thead>
									<tr className="border-b border-[var(--nx-border)] text-start text-xs uppercase tracking-wider text-[var(--nx-muted)]">
										<th className="px-4 py-3 text-start">Offer</th>
										<th className="px-4 py-3 text-start">Credit</th>
										<th className="px-4 py-3 text-start">Audience</th>
										<th className="px-4 py-3 text-start">Top-up gate</th>
										<th className="px-4 py-3 text-start">Models</th>
										<th className="px-4 py-3 text-start">Claims</th>
										<th className="px-4 py-3 text-start">Window</th>
										<th className="px-4 py-3 text-start">Status</th>
										<th className="px-4 py-3" />
									</tr>
								</thead>
								<tbody className="divide-y divide-[var(--nx-border)]">
									{offers.map((o) => {
										const expired = o.valid_to != null && new Date(o.valid_to) < new Date();
										return (
											<tr key={o.id} className="transition-colors hover:bg-cyan-500/[0.03]">
												<td className="px-4 py-3 font-medium">{o.name}</td>
												<td className="px-4 py-3 font-data text-xs tabular-nums">
													${Number(o.amount_usd).toFixed(2)}
													{o.expires_days != null && <span className="ms-1 text-[var(--nx-muted)]">· expires {o.expires_days}d after claim</span>}
												</td>
												<td className="px-4 py-3 text-xs">
													{AUDIENCE_LABEL[o.audience]}
													{o.audience === 'new_users' && <span className="text-[var(--nx-muted)]"> · ≤{o.new_user_days}d old</span>}
													{o.audience === 'plan_subscribers' && (
														<span className="text-[var(--nx-muted)]"> · {plans.find((p) => p.id === o.audience_plan_id)?.name?.en ?? 'plan'}</span>
													)}
												</td>
												<td className="px-4 py-3 font-data text-xs tabular-nums">
													{o.require_topup_usd != null ? `$${Number(o.require_topup_usd).toFixed(2)} lifetime` : <span className="text-[var(--nx-muted)]">none</span>}
												</td>
												<td className="px-4 py-3"><Pill tone="teal">{o.model_ids.length}</Pill></td>
												<td className="px-4 py-3 font-data text-xs tabular-nums">
													{claims[o.id] ?? 0}{o.max_claims != null ? ` / ${o.max_claims}` : ''}
												</td>
												<td className="px-4 py-3 text-xs text-[var(--nx-muted)]">
													{(o.valid_from ?? '').slice(0, 10)} → {o.valid_to ? o.valid_to.slice(0, 10) : '∞'}
												</td>
												<td className="px-4 py-3">
													{!o.active ? <Pill tone="gray">off</Pill>
														: expired ? <Pill tone="red">expired</Pill>
														: <Pill tone="green">live</Pill>}
												</td>
												<td className="px-4 py-3 text-end">
													<div className="flex justify-end gap-1">
														<button onClick={() => toggleActive(o)} title={o.active ? 'Deactivate' : 'Activate'} className="rounded-lg p-2 text-[var(--nx-muted)] hover:bg-cyan-500/10 hover:text-cyan-400">
															<Power size={14} />
														</button>
														<button onClick={() => setModal({ kind: 'edit', offer: o })} title="Edit" className="rounded-lg p-2 text-[var(--nx-muted)] hover:bg-cyan-500/10 hover:text-cyan-400">
															<Pencil size={14} />
														</button>
														<button onClick={() => { setDeleteError(null); setConfirmOffer(o); }} title="Delete" className="rounded-lg p-2 text-[var(--nx-muted)] hover:bg-red-500/10 hover:text-red-400">
															<Trash2 size={14} />
														</button>
													</div>
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					)}
				</div>
			</div>

			{modal?.kind === 'edit' && (
				<OfferModal
					offer={modal.offer}
					plans={plans}
					minTopup={minTopup}
					onClose={() => { setModal(null); void load(); }}
				/>
			)}

			<ConfirmDialog
				open={!!confirmOffer}
				title={`Delete offer "${confirmOffer?.name ?? ''}"?`}
				body="Claims keep their remaining credit, but no new users can receive this offer."
				error={deleteError}
				busy={deleting}
				confirmLabel="Delete offer"
				onConfirm={destroyOffer}
				onCancel={() => setConfirmOffer(null)}
			/>
		</DashboardShell>
	);
}

// ---------------- offer create/edit modal ----------------
function OfferModal({ offer, plans, minTopup, onClose }: { offer: OfferRow | null; plans: PlanRow[]; minTopup: number; onClose: () => void }) {
	const [name, setName] = useState(offer?.name ?? '');
	const [amount, setAmount] = useState(offer ? String(offer.amount_usd) : '10');
	const [modelIds, setModelIds] = useState<Set<string>>(new Set(offer?.model_ids ?? []));
	const [audience, setAudience] = useState<OfferRow['audience']>(offer?.audience ?? 'new_users');
	const [planId, setPlanId] = useState(offer?.audience_plan_id ?? '');
	const [newUserDays, setNewUserDays] = useState(String(offer?.new_user_days ?? 30));
	const [requireTopup, setRequireTopup] = useState(offer?.require_topup_usd != null ? String(offer.require_topup_usd) : '');
	const [expiresDays, setExpiresDays] = useState(offer?.expires_days != null ? String(offer.expires_days) : '30');
	const [maxClaims, setMaxClaims] = useState(offer?.max_claims != null ? String(offer.max_claims) : '');
	const [active, setActive] = useState(offer?.active ?? true);
	const [validFrom, setValidFrom] = useState(offer ? offer.valid_from.slice(0, 10) : new Date().toISOString().slice(0, 10));
	const [validTo, setValidTo] = useState(offer?.valid_to ? offer.valid_to.slice(0, 10) : '');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const [models, setModels] = useState<PickModel[]>([]);
	const [query, setQuery] = useState('');
	useEffect(() => {
		void (async () => {
			const { data } = await supabase
				.from('models_public_view')
				.select('id,display_name,vendor_slug,payg_enabled')
				.eq('enabled_for_users', true)
				.eq('payg_enabled', true)
				.order('display_name')
				.limit(500);
			setModels((data ?? []) as PickModel[]);
		})();
	}, []);

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		return q ? models.filter((m) => m.display_name.toLowerCase().includes(q)) : models;
	}, [models, query]);

	async function save() {
		setError(null);
		if (!name.trim()) { setError('Give the offer a name.'); return; }
		const amt = Number(amount);
		if (!Number.isFinite(amt) || amt <= 0) { setError('Credit amount must be greater than 0.'); return; }
		if (modelIds.size === 0) { setError('Select at least one model the credit can be used on.'); return; }
		if (audience === 'plan_subscribers' && !planId) { setError('Pick the plan whose subscribers are eligible.'); return; }
		const req = requireTopup.trim() === '' ? null : Number(requireTopup);
		if (req != null && (!Number.isFinite(req) || req < minTopup)) {
			setError(`The top-up gate cannot be below the wallet minimum ($${minTopup}).`);
			return;
		}
		const exp = expiresDays.trim() === '' ? null : Number(expiresDays);
		if (exp != null && (!Number.isFinite(exp) || exp <= 0)) { setError('Credit validity (days) must be a positive number, or empty for no expiry.'); return; }
		const mc = maxClaims.trim() === '' ? null : Number(maxClaims);
		if (mc != null && (!Number.isFinite(mc) || mc <= 0)) { setError('Max claims must be a positive number, or empty for unlimited.'); return; }

		setBusy(true);
		const payload = {
			name: name.trim(),
			amount_usd: amt,
			model_ids: [...modelIds],
			audience,
			audience_plan_id: audience === 'plan_subscribers' ? planId : null,
			new_user_days: Math.max(1, Number(newUserDays) || 30),
			require_topup_usd: req,
			expires_days: exp,
			max_claims: mc,
			active,
			valid_from: validFrom ? new Date(validFrom).toISOString() : new Date().toISOString(),
			valid_to: validTo ? new Date(validTo).toISOString() : null,
		};
		const { error: dbErr } = offer
			? await supabase.from('credit_offers').update(payload).eq('id', offer.id)
			: await supabase.from('credit_offers').insert(payload);
		setBusy(false);
		if (dbErr) { setError(dbErr.message); return; }
		onClose();
	}

	return (
		<div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm">
			<div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-[var(--nx-border)] bg-[var(--nx-surface)] shadow-2xl">
				<header className="flex items-center justify-between border-b border-[var(--nx-border)] px-6 py-4">
					<div>
						<h2 className="font-semibold">{offer ? 'Edit offer' : 'New free-credit offer'}</h2>
						<p className="text-xs text-[var(--nx-muted)]">Credit lands in the wallet but only pays for the models you pick.</p>
					</div>
					<button onClick={onClose} className="rounded-lg p-1.5 text-[var(--nx-muted)] hover:bg-zinc-800/60"><X size={18} /></button>
				</header>

				<div className="space-y-5 overflow-y-auto px-6 py-4">
					{error && <div className="rounded-lg bg-red-500/10 px-4 py-2.5 text-sm text-red-400">{error}</div>}

					<div className="grid grid-cols-2 gap-3">
						<label className="block text-xs">
							<span className="text-[var(--nx-muted)]">Offer name</span>
							<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Welcome credit" className="mt-1 w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-cyan-500" />
						</label>
						<label className="block text-xs">
							<span className="text-[var(--nx-muted)]">Credit amount (USD)</span>
							<input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" dir="ltr" className="mt-1 w-full rounded-md border border-border bg-transparent px-3 py-2 font-data text-sm tabular-nums outline-none focus:border-cyan-500" />
						</label>
					</div>

					{/* models */}
					<fieldset className="rounded-xl border border-border p-4">
						<legend className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Models the credit can pay for</legend>
						<div className="relative mt-2">
							<Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
							<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search models…" className="w-full rounded-md border border-border bg-transparent py-2 pe-3 ps-9 text-sm outline-none focus:border-cyan-500" />
						</div>
						<div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
							<span>{modelIds.size} selected</span>
							<button onClick={() => setModelIds(new Set(filtered.map((m) => m.id)))} className="hover:text-cyan-400">select shown</button>
							<button onClick={() => setModelIds(new Set())} className="hover:text-cyan-400">clear</button>
						</div>
						<div className="mt-1 max-h-48 space-y-0.5 overflow-y-auto rounded-lg border border-border p-2">
							{filtered.map((m) => (
								<label key={m.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-cyan-500/5">
									<input
										type="checkbox"
										checked={modelIds.has(m.id)}
										onChange={(e) => {
											const next = new Set(modelIds);
											if (e.target.checked) next.add(m.id); else next.delete(m.id);
											setModelIds(next);
										}}
										className="accent-cyan-500"
									/>
									<span className="truncate">{m.display_name}</span>
									{m.vendor_slug && <Pill tone="gray">{m.vendor_slug}</Pill>}
								</label>
							))}
							{filtered.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">No PAYG-priced models found.</p>}
						</div>
						<p className="mt-2 text-xs text-muted-foreground">
							Only PAYG-priced models appear — offer credit pays per token, so a model needs token prices.
						</p>
					</fieldset>

					{/* audience */}
					<fieldset className="rounded-xl border border-border p-4">
						<legend className="flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
							<Users size={12} /> Who can claim it
						</legend>
						<div className="mt-2 grid gap-2 sm:grid-cols-3">
							{(['new_users', 'plan_subscribers', 'topped_up'] as const).map((a) => (
								<label key={a} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${audience === a ? 'border-cyan-500 bg-cyan-500/10' : 'border-border'}`}>
									<input type="radio" checked={audience === a} onChange={() => setAudience(a)} className="accent-cyan-500" />
									{AUDIENCE_LABEL[a]}
								</label>
							))}
						</div>
						{audience === 'new_users' && (
							<label className="mt-3 flex items-center gap-2 text-sm">
								Account younger than
								<input type="number" min={1} value={newUserDays} onChange={(e) => setNewUserDays(e.target.value)} dir="ltr" className="w-16 rounded-md border border-border bg-transparent px-2 py-1 font-data text-xs tabular-nums outline-none focus:border-cyan-500" />
								days
							</label>
						)}
						{audience === 'plan_subscribers' && (
							<label className="mt-3 block text-xs">
								<span className="text-[var(--nx-muted)]">Plan</span>
								<select value={planId} onChange={(e) => setPlanId(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-transparent px-2 py-2 text-sm outline-none focus:border-cyan-500">
									<option value="">— pick a plan —</option>
									{plans.map((p) => (
										<option key={p.id} value={p.id}>{p.name?.en ?? p.name?.ar ?? p.id}</option>
									))}
								</select>
							</label>
						)}
						{audience === 'topped_up' && (
							<p className="mt-3 text-xs text-muted-foreground">Anyone with at least one wallet top-up can claim.</p>
						)}
					</fieldset>

					{/* conditions */}
					<fieldset className="rounded-xl border border-border p-4">
						<legend className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Conditions & limits</legend>
						<div className="mt-2 grid grid-cols-2 gap-3">
							<label className="block text-xs">
								<span className="text-[var(--nx-muted)]">Top-up gate (lifetime, optional)</span>
								<input value={requireTopup} onChange={(e) => setRequireTopup(e.target.value)} placeholder={`min $${minTopup}`} inputMode="decimal" dir="ltr" className="mt-1 w-full rounded-md border border-border bg-transparent px-3 py-2 font-data text-sm tabular-nums outline-none focus:border-cyan-500" />
								<span className="mt-0.5 block text-[11px] text-muted-foreground">User must have topped up this much before claiming. Empty = no gate.</span>
							</label>
							<label className="block text-xs">
								<span className="text-[var(--nx-muted)]">Credit expires after (days from claim)</span>
								<input value={expiresDays} onChange={(e) => setExpiresDays(e.target.value)} placeholder="empty = never" inputMode="numeric" dir="ltr" className="mt-1 w-full rounded-md border border-border bg-transparent px-3 py-2 font-data text-sm tabular-nums outline-none focus:border-cyan-500" />
							</label>
							<label className="block text-xs">
								<span className="text-[var(--nx-muted)]">Max total claims (optional)</span>
								<input value={maxClaims} onChange={(e) => setMaxClaims(e.target.value)} placeholder="empty = unlimited" inputMode="numeric" dir="ltr" className="mt-1 w-full rounded-md border border-border bg-transparent px-3 py-2 font-data text-sm tabular-nums outline-none focus:border-cyan-500" />
							</label>
							<div className="text-xs">
								<span className="text-[var(--nx-muted)]">Offer window</span>
								<div className="mt-1 grid grid-cols-2 gap-2">
									<input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} className="w-full rounded-md border border-border bg-transparent px-2 py-2 font-data text-xs outline-none focus:border-cyan-500" />
									<input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} className="w-full rounded-md border border-border bg-transparent px-2 py-2 font-data text-xs outline-none focus:border-cyan-500" />
								</div>
								<span className="mt-0.5 block text-[11px] text-muted-foreground">End date empty = runs forever.</span>
							</div>
						</div>
						<label className="mt-3 flex items-center gap-2 text-sm">
							<input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="accent-cyan-500" />
							Offer is active
						</label>
					</fieldset>
				</div>

				<footer className="flex items-center justify-end gap-2 border-t border-[var(--nx-border)] px-6 py-4">
					<button onClick={onClose} className="rounded-lg border border-[var(--nx-border)] px-4 py-2 text-sm">Cancel</button>
					<button onClick={save} disabled={busy} className="rounded-lg bg-cyan-600 px-5 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-40">
						{busy ? 'Saving…' : offer ? 'Save offer' : 'Create offer'}
					</button>
				</footer>
			</div>
		</div>
	);
}
