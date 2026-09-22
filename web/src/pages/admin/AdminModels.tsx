import { useCallback, useEffect, useMemo, useState } from 'react';
import {
	Search, Tags, Star, Percent, Gauge, Save, X, Sparkles, Pencil,
	EyeOff, RefreshCw, Type, Image as ImageIcon, AudioLines, Video, Layers,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { edgeCall } from '../../lib/admin-api';
import { DashboardShell } from '../../components/DashboardShell';
import { PageHeader, Pill, EmptyState, compactTokens } from '../../components/console-kit';
import { VendorMark, vendorLabel } from '../../design-system/vendor-marks';

interface AdminModelRow {
	id: string;
	slug: string;
	upstream_model_id: string;
	display_name: string;
	description: string | null;
	context_window: number | null;
	usage_multiplier: number | string;
	enabled_for_users: boolean;
	payg_enabled: boolean;
	input_price_per_m: number | null;
	output_price_per_m: number | null;
	cache_read_price_per_m: number | null;
	cache_write_price_per_m: number | null;
	input_modalities: string[] | null;
	output_modalities: string[] | null;
	supports_reasoning: boolean;
	quality_score: number | null;
	is_featured: boolean;
	is_custom: boolean;
	vendor_slug: string | null;
	provider_id: string | null;
	provider_name: string | null;
	provider_kind: string | null;
	tok_per_s: number | null;
	avg_ttft_ms: number | null;
	discount_percent: number | null;
	is_priced: boolean;
}

interface DiscountRow {
	id: string;
	model_id: string;
	applies_to: string;
	kind: string;
	value: number | string;
	valid_from: string | null;
	valid_to: string | null;
	active: boolean;
}

interface RateLimitRow {
	model_id: string;
	rpm: number | null;
	rph: number | null;
	rpd: number | null;
	tpm: number | null;
}

interface PlanRow {
	id: string;
	name: Record<string, string>;
	active: boolean;
}

type Modal =
	| { kind: 'pricing'; model: AdminModelRow }
	| { kind: 'meta'; model: AdminModelRow }
	| { kind: 'custom' };

interface ProviderRow {
	id: string;
	display_name: string;
	kind: string;
}

interface VendorRow {
	slug: string;
	display_name: string;
}

function ModalityDots({ mods }: { mods: string[] | null }) {
	const icons = [
		{ key: 'text', node: <Type size={11} /> },
		{ key: 'image', node: <ImageIcon size={11} /> },
		{ key: 'audio', node: <AudioLines size={11} /> },
		{ key: 'video', node: <Video size={11} /> },
	];
	return (
		<div className="flex items-center gap-1">
			{icons.map(({ key, node }) => {
				const on = (mods ?? ['text']).includes(key);
				return (
					<span
						key={key}
						title={key}
						className={`grid size-6 place-items-center rounded-md border ${
							on ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-400' : 'border-border/50 text-muted-foreground/30'
						}`}
					>
						{node}
					</span>
				);
			})}
		</div>
	);
}

function priceCell(base: number | null, discount: number | null): { text: string; struck: boolean } {
	if (base == null) return { text: '—', struck: false };
	return { text: `$${base.toFixed(base < 1 ? 3 : 2)}`, struck: !!(discount && discount > 0) };
}

const PAGE_SIZE = 100;

export default function AdminModels() {
	const [email, setEmail] = useState('');
	const [rows, setRows] = useState<AdminModelRow[]>([]);
	const [loading, setLoading] = useState(true);
	const [query, setQuery] = useState('');
	const [vendor, setVendor] = useState('any');
	const [status, setStatus] = useState('selected');
	const [page, setPage] = useState(1);
	const [modal, setModal] = useState<Modal | null>(null);
	const [providers, setProviders] = useState<ProviderRow[]>([]);
	const [provider, setProvider] = useState('any');
	const [enriching, setEnriching] = useState(false);
	const [enrichMsg, setEnrichMsg] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		const { data: { user } } = await supabase.auth.getUser();
		if (user) setEmail(user.email ?? '');
		// page through everything — PostgREST caps single responses at 1000
		// rows and the catalog is bigger than that once several providers sync.
		// admin view: security_invoker — RLS lets admins see hidden rows too
		const all: unknown[] = [];
		for (let from = 0; from < 20_000; from += 1000) {
			const { data } = await supabase
				.from('models_admin_view')
				.select('*')
				.order('display_name')
				.range(from, from + 999);
			if (!data?.length) break;
			all.push(...data);
			if (data.length < 1000) break;
		}
		setRows(all as unknown as AdminModelRow[]);
		// gateway providers (connections) — separate from vendor_slug brands
		const { data: provs } = await supabase.from('providers').select('id,display_name,kind').order('display_name');
		setProviders((provs ?? []) as ProviderRow[]);
		setLoading(false);
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	// fill missing context windows from OpenRouter's public catalog
	async function enrichContext() {
		setEnriching(true);
		setEnrichMsg(null);
		const res = await edgeCall<{ enriched?: number; scanned?: number; error?: string }>(
			'admin-sync-models',
			{ action: 'enrich_context' },
		);
		setEnriching(false);
		if (res?.error) { setEnrichMsg(res.error); return; }
		setEnrichMsg(`Filled context for ${res?.enriched ?? 0} of ${res?.scanned ?? 0} models that were missing one.`);
		await load();
	}

	const vendors = useMemo(
		() => [...new Set(rows.map((r) => r.vendor_slug ?? 'other'))].sort((a, b) => vendorLabel(a).localeCompare(vendorLabel(b))),
		[rows],
	);

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		return rows.filter((r) => {
			if (q && !r.display_name.toLowerCase().includes(q) && !r.upstream_model_id.toLowerCase().includes(q)) return false;
			if (vendor !== 'any' && (r.vendor_slug ?? 'other') !== vendor) return false;
			if (provider !== 'any' && (r.provider_id ?? 'none') !== provider) return false;
			if (status === 'selected' && !r.enabled_for_users) return false;
			if (status === 'priced' && !r.is_priced) return false;
			if (status === 'unpriced' && (r.is_priced || !r.enabled_for_users)) return false;
			if (status === 'hidden' && r.enabled_for_users) return false;
			if (status === 'custom' && !r.is_custom) return false;
			return true;
		});
	}, [rows, query, vendor, provider, status]);

	// reset to the first page whenever the filters change
	useEffect(() => {
		setPage(1);
	}, [query, vendor, provider, status]);

	const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
	const safePage = Math.min(page, pageCount);
	const paged = useMemo(
		() => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
		[filtered, safePage],
	);

	return (
		<DashboardShell variant="admin" email={email}>
			<div className="space-y-6">
				<PageHeader
					title="Models & Pricing"
					subtitle="Every synced model with its effective prices, discounts, throughput and live status."
					actions={
						<>
							<button
								onClick={() => void enrichContext()}
								disabled={enriching}
								title="Fill missing context windows from OpenRouter's public catalog"
								className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:border-cyan-500/50 disabled:opacity-40"
							>
								<Layers size={14} className={enriching ? 'animate-pulse' : ''} /> {enriching ? 'Filling…' : 'Fill missing context'}
							</button>
							<button
								onClick={() => setModal({ kind: 'custom' })}
								className="flex items-center gap-2 rounded-lg border border-violet-500/50 bg-violet-500/10 px-4 py-2 text-sm font-medium text-violet-300 hover:bg-violet-500/20"
							>
								<Sparkles size={15} /> Custom model
							</button>
							<button onClick={() => void load()} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:border-cyan-500/50">
								<RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
							</button>
						</>
					}
				/>

				{enrichMsg && (
					<p className="rounded-lg bg-cyan-500/10 px-3 py-2 text-xs text-cyan-300">{enrichMsg}</p>
				)}

				<div className="flex flex-wrap items-center gap-2">
					<label className="relative min-w-52 flex-1">
						<Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
						<input
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							placeholder="Search models…"
							className="w-full rounded-lg border border-border bg-transparent py-2 pe-3 ps-9 text-sm outline-none focus:border-cyan-500"
						/>
					</label>
					<select value={vendor} onChange={(e) => setVendor(e.target.value)} className="h-9 rounded-lg border border-border bg-transparent px-3 text-sm outline-none focus:border-cyan-500">
						<option value="any">All vendors</option>
						{vendors.map((v) => <option key={v} value={v}>{vendorLabel(v)}</option>)}
					</select>
					<select value={provider} onChange={(e) => setProvider(e.target.value)} className="h-9 rounded-lg border border-border bg-transparent px-3 text-sm outline-none focus:border-cyan-500">
						<option value="any">All providers</option>
						{providers.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
					</select>
					<select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-lg border border-border bg-transparent px-3 text-sm outline-none focus:border-cyan-500">
						<option value="selected">Selected models</option>
						<option value="all">All synced models</option>
						<option value="priced">Priced</option>
						<option value="unpriced">Unpriced</option>
						<option value="hidden">Hidden from users</option>
						<option value="custom">Custom models</option>
					</select>
					<span className="font-data text-xs text-muted-foreground">
						{filtered.length} model{filtered.length === 1 ? '' : 's'}
					</span>
				</div>

				{loading ? (
					<div className="rounded-xl border border-border px-6 py-16 text-center text-sm text-muted-foreground">Loading catalog…</div>
				) : filtered.length === 0 ? (
					<EmptyState icon={<Tags size={26} />} title="No models match" hint="Select models from a provider first (Providers page), then price them here." />
				) : (
					<>
					<div className="overflow-x-auto rounded-xl border border-[var(--nx-border)]">
						<table className="w-full min-w-[1180px] text-sm">
							<thead className="bg-zinc-900/60 font-data text-[11px] uppercase tracking-wider text-[var(--nx-muted)]">
								<tr>
									<th className="px-4 py-3 text-start">Model</th>
									<th className="px-4 py-3 text-start">Provider</th>
									<th className="px-4 py-3 text-start">Vendor</th>
									<th className="px-4 py-3 text-start">Context</th>
									<th className="px-4 py-3 text-start">Input $/M</th>
									<th className="px-4 py-3 text-start">Output $/M</th>
									<th className="px-4 py-3 text-start">Modalities</th>
									<th className="px-4 py-3 text-start">Tok/s</th>
									<th className="px-4 py-3 text-start">Latency</th>
									<th className="px-4 py-3 text-start">Status</th>
									<th className="px-4 py-3" />
								</tr>
							</thead>
							<tbody className="divide-y divide-[var(--nx-border)]">
								{paged.map((m) => {
									const inP = priceCell(m.input_price_per_m, m.discount_percent);
									const outP = priceCell(m.output_price_per_m, m.discount_percent);
									return (
										<tr key={m.id} className="transition-colors hover:bg-cyan-500/[0.03]">
											<td className="px-4 py-3">
												<div className="flex items-center gap-2">
													{m.is_featured && <Star size={12} className="shrink-0 fill-violet-400 text-violet-400" />}
													<span className="max-w-56 truncate font-medium">{m.display_name}</span>
												</div>
												<p className="max-w-56 truncate font-data text-[10px] text-[var(--nx-muted)]">{m.upstream_model_id}</p>
											</td>
											<td className="px-4 py-3">
												<span className="inline-flex items-center gap-1.5 rounded-md bg-zinc-800/60 px-2 py-0.5 text-xs">
													{m.provider_name ?? <span className="text-[var(--nx-muted)]">unassigned</span>}
												</span>
											</td>
											<td className="px-4 py-3">
												<span className="inline-flex items-center gap-1.5">
													<VendorMark slug={m.vendor_slug} className="size-4 shrink-0" />
													<span className="text-xs">{vendorLabel(m.vendor_slug)}</span>
												</span>
											</td>
											<td className="px-4 py-3 font-data text-xs tabular-nums">{m.context_window ? compactTokens(m.context_window) : '—'}</td>
											<td className={`px-4 py-3 font-data text-xs tabular-nums ${inP.struck ? 'line-through decoration-amber-500/80' : ''}`}>{inP.text}</td>
											<td className={`px-4 py-3 font-data text-xs tabular-nums ${outP.struck ? 'line-through decoration-amber-500/80' : ''}`}>{outP.text}</td>
											<td className="px-4 py-3"><ModalityDots mods={m.input_modalities} /></td>
											<td className="px-4 py-3 font-data text-xs tabular-nums text-cyan-300/90">{m.tok_per_s ? Math.round(Number(m.tok_per_s)) : '—'}</td>
											<td className="px-4 py-3 font-data text-xs tabular-nums">{m.avg_ttft_ms ? `${(Number(m.avg_ttft_ms) / 1000).toFixed(2)}s` : '—'}</td>
											<td className="px-4 py-3">
												{!m.is_priced
													? <Pill tone="red">Unpriced</Pill>
													: m.enabled_for_users
														? <Pill tone="green">Available</Pill>
														: <Pill tone="gray"><EyeOff size={11} /> Hidden</Pill>}
												{Number(m.discount_percent ?? 0) > 0 && <Pill tone="amber" className="ms-1"><Percent size={10} />{Math.round(Number(m.discount_percent))}%</Pill>}
												{m.is_custom && <Pill tone="violet" className="ms-1">Custom</Pill>}
											</td>
											<td className="px-4 py-3 text-end">
												<div className="flex justify-end gap-1">
													<button onClick={() => setModal({ kind: 'meta', model: m })} title="Edit metadata" className="rounded-lg p-2 text-[var(--nx-muted)] hover:bg-cyan-500/10 hover:text-cyan-300">
														<Pencil size={14} />
													</button>
													<button onClick={() => setModal({ kind: 'pricing', model: m })} className="rounded-lg border border-cyan-500/50 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-300 hover:bg-cyan-500/20">
														Pricing
													</button>
												</div>
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>

					{/* pagination — 100 rows per page */}
					<div className="flex items-center justify-between gap-3 pt-3">
						<p className="font-data text-xs text-muted-foreground">
							Page {safePage} / {pageCount} · showing {paged.length} of {filtered.length}
						</p>
						<div className="flex items-center gap-2">
							<button
								onClick={() => setPage((p) => Math.max(1, p - 1))}
								disabled={safePage <= 1}
								className="rounded-lg border border-border px-3 py-1.5 text-sm disabled:opacity-40 hover:border-cyan-500/50"
							>
								Prev
							</button>
							<button
								onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
								disabled={safePage >= pageCount}
								className="rounded-lg border border-border px-3 py-1.5 text-sm disabled:opacity-40 hover:border-cyan-500/50"
							>
								Next
							</button>
						</div>
					</div>
					</>
				)}
			</div>

			{modal?.kind === 'pricing' && (
				<PricingModal model={modal.model} onClose={() => { setModal(null); void load(); }} />
			)}
			{modal?.kind === 'meta' && (
				<MetaModal model={modal.model} providers={providers} onClose={() => { setModal(null); void load(); }} />
			)}
			{modal?.kind === 'custom' && (
				<CustomModelModal onClose={() => { setModal(null); void load(); }} />
			)}
		</DashboardShell>
	);
}

// ---------------- pricing modal ----------------
function PricingModal({ model, onClose }: { model: AdminModelRow; onClose: () => void }) {
	const [mult, setMult] = useState(String(Number(model.usage_multiplier) || 1));
	const [payg, setPayg] = useState(model.payg_enabled);
	const [pin, setPin] = useState(model.input_price_per_m?.toString() ?? '');
	const [pout, setPout] = useState(model.output_price_per_m?.toString() ?? '');
	const [pcr, setPcr] = useState(model.cache_read_price_per_m?.toString() ?? '');
	const [pcw, setPcw] = useState(model.cache_write_price_per_m?.toString() ?? '');

	const [plans, setPlans] = useState<PlanRow[]>([]);
	const [planIds, setPlanIds] = useState<Set<string>>(new Set());

	const [disc, setDisc] = useState<DiscountRow | null>(null);
	const [rl, setRl] = useState<RateLimitRow>({ model_id: model.id, rpm: null, rph: null, rpd: null, tpm: null });
	const [visible, setVisible] = useState(model.enabled_for_users);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		void (async () => {
			const [fresh, pl, pm, dl, rlq] = await Promise.all([
				// load the REAL saved pricing straight from the models table —
				// the table row carries effective (post-discount) prices only
				supabase.from('models').select(
					'usage_multiplier,payg_enabled,input_price_per_m,output_price_per_m,cache_read_price_per_m,cache_write_price_per_m,enabled_for_users',
				).eq('id', model.id).maybeSingle(),
				supabase.from('plans').select('id,name,active').order('price_usd'),
				supabase.from('plan_models').select('plan_id').eq('model_id', model.id),
				// latest discount even if inactive/expired, so the admin sees what was saved
				supabase.from('model_discounts').select('*').eq('model_id', model.id).order('created_at', { ascending: false }).limit(1),
				supabase.from('model_rate_limits').select('*').eq('model_id', model.id).maybeSingle(),
			]);
			const f = fresh.data;
			if (f) {
				setMult(String(Number(f.usage_multiplier) || 0));
				setPayg(!!f.payg_enabled);
				setPin(f.input_price_per_m != null ? String(f.input_price_per_m) : '');
				setPout(f.output_price_per_m != null ? String(f.output_price_per_m) : '');
				setPcr(f.cache_read_price_per_m != null ? String(f.cache_read_price_per_m) : '');
				setPcw(f.cache_write_price_per_m != null ? String(f.cache_write_price_per_m) : '');
				setVisible(!!f.enabled_for_users);
			}
			setPlans((pl.data ?? []) as PlanRow[]);
			setPlanIds(new Set((pm.data ?? []).map((r: { plan_id: string }) => r.plan_id)));
			const d = (dl.data ?? [])[0] as DiscountRow | undefined;
			if (d) setDisc({
				...d,
				valid_from: d.valid_from ? d.valid_from.slice(0, 10) : '',
				valid_to: d.valid_to ? d.valid_to.slice(0, 10) : '',
			});
			if (rlq.data) setRl(rlq.data as RateLimitRow);
		})();
	}, [model.id]);

	async function save() {
		setBusy(true);
		setError(null);
		const multiplier = Number(mult);
		if (!Number.isFinite(multiplier) || multiplier < 0) {
			setError('Multiplier must be 0 or more (0 = free on plans, 1 = no weighting).');
			setBusy(false);
			return;
		}
		const num = (s: string) => (s.trim() === '' ? null : Number(s));
		const neg = [pin, pout, pcr, pcw].some((s) => s.trim() !== '' && Number(s) < 0);
		if (neg) {
			setError('Prices cannot be negative (0 = free for that bucket).');
			setBusy(false);
			return;
		}
		if (payg && num(pin) == null && num(pout) == null) {
			setError('PAYG needs at least an input or output price (0 counts as free).');
			setBusy(false);
			return;
		}

		// models row: multiplier, PAYG prices, visibility
		const { error: mErr } = await supabase.from('models').update({
			usage_multiplier: multiplier,
			payg_enabled: payg,
			input_price_per_m: num(pin),
			output_price_per_m: num(pout),
			cache_read_price_per_m: num(pcr) ?? 0,
			cache_write_price_per_m: num(pcw) ?? 0,
			enabled_for_users: visible,
		}).eq('id', model.id);
		if (mErr) { setError(mErr.message); setBusy(false); return; }

		// plan membership sync (delete-all + re-insert of the delta)
		const { data: prevRows, error: prevErr } = await supabase.from('plan_models').select('plan_id').eq('model_id', model.id);
		if (prevErr) { setError(prevErr.message); setBusy(false); return; }
		const prev = new Set((prevRows ?? []).map((r: { plan_id: string }) => r.plan_id));
		const toAdd = [...planIds].filter((id) => !prev.has(id));
		const toRemove = [...prev].filter((id) => !planIds.has(id));
		if (toAdd.length) {
			const { error: addErr } = await supabase.from('plan_models').insert(toAdd.map((plan_id) => ({ plan_id, model_id: model.id })));
			if (addErr) { setError(addErr.message); setBusy(false); return; }
		}
		for (const plan_id of toRemove) {
			const { error: rmErr } = await supabase.from('plan_models').delete().eq('plan_id', plan_id).eq('model_id', model.id);
			if (rmErr) { setError(rmErr.message); setBusy(false); return; }
		}

		// discount: replace the model's active discounts with the edited one.
		// valid_to may be null — empty expiry means "never expires".
		const { error: delDiscErr } = await supabase.from('model_discounts').delete().eq('model_id', model.id).eq('active', true);
		if (delDiscErr) { setError(delDiscErr.message); setBusy(false); return; }
		if (disc && Number(disc.value) > 0) {
			const { error: dErr } = await supabase.from('model_discounts').insert({
				model_id: model.id,
				applies_to: disc.applies_to,
				kind: disc.kind,
				value: Number(disc.value),
				valid_from: disc.valid_from || new Date().toISOString().slice(0, 10),
				valid_to: disc.valid_to || null,
				active: true,
			});
			if (dErr) { setError(dErr.message); setBusy(false); return; }
		}

		// rate limits: upsert row, delete when fully empty
		const hasRl = rl.rpm != null || rl.rph != null || rl.rpd != null || rl.tpm != null;
		if (hasRl) {
			const { error: rErr } = await supabase.from('model_rate_limits').upsert({
				model_id: model.id,
				rpm: rl.rpm ?? null, rph: rl.rph ?? null, rpd: rl.rpd ?? null, tpm: rl.tpm ?? null,
			});
			if (rErr) { setError(rErr.message); setBusy(false); return; }
		} else {
			await supabase.from('model_rate_limits').delete().eq('model_id', model.id);
		}

		setBusy(false);
		onClose();
	}

	return (
		<ModalFrame title={`Pricing — ${model.display_name}`} onClose={onClose} footer={
			<>
				<button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm">Cancel</button>
				<button onClick={save} disabled={busy} className="flex items-center gap-2 rounded-lg bg-cyan-600 px-5 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-40">
					<Save size={14} /> {busy ? 'Saving…' : 'Save pricing'}
				</button>
			</>
		}>
			{error && <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-2.5 text-sm text-red-400">{error}</div>}

			{/* plans */}
			<fieldset className="rounded-xl border border-border p-4">
				<legend className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pricing plans (weighted tokens)</legend>
				<label className="mt-2 flex items-center gap-2 text-sm">
					<input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} className="accent-cyan-500" />
					Visible to users <span className="text-xs text-muted-foreground">(required for plan billing)</span>
				</label>
				<label className="mt-3 flex items-center gap-2 text-sm">
					Usage multiplier
					<input
						type="number" min={0} step="any" value={mult}
						onChange={(e) => setMult(e.target.value)}
						dir="ltr"
						className="w-20 rounded-md border border-border bg-transparent px-2 py-1 font-data text-xs tabular-nums outline-none focus:border-cyan-500"
					/>
					<span className="text-xs text-muted-foreground">×1 = no weighting · ×0 = free on plans</span>
				</label>
				<div className="mt-3 max-h-36 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
					{plans.map((p) => (
						<label key={p.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-cyan-500/5">
							<input
								type="checkbox"
								checked={planIds.has(p.id)}
								onChange={(e) => {
									const next = new Set(planIds);
									if (e.target.checked) next.add(p.id); else next.delete(p.id);
									setPlanIds(next);
								}}
								className="accent-cyan-500"
							/>
							<span className="truncate">{p.name?.en ?? p.name?.ar ?? p.id}</span>
							{!p.active && <Pill tone="gray">hidden</Pill>}
						</label>
					))}
				</div>
				<p className="mt-2 text-xs text-muted-foreground">No selection = every plan can use this model.</p>
			</fieldset>

			{/* PAYG */}
			<fieldset className="mt-4 rounded-xl border border-border p-4">
				<legend className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pay-As-You-Go</legend>
				<label className="mt-2 flex items-center gap-2 text-sm">
					<input type="checkbox" checked={payg} onChange={(e) => setPayg(e.target.checked)} className="accent-cyan-500" />
					Charge wallet per token (USD per 1M tokens)
				</label>
				{payg && (
					<div className="mt-3 grid grid-cols-2 gap-3">
						<PriceInput label="Input / 1M (0 = free)" value={pin} onChange={setPin} />
						<PriceInput label="Output / 1M (0 = free)" value={pout} onChange={setPout} />
						<PriceInput label="Cache read / 1M (0 = free)" value={pcr} onChange={setPcr} />
						<PriceInput label="Cache write / 1M (0 = free)" value={pcw} onChange={setPcw} />
					</div>
				)}
				<p className="mt-2 text-xs text-muted-foreground">
					Empty = not priced for that bucket · 0 = free · A model can be in plans AND support PAYG — users choose their billing mode.
				</p>
			</fieldset>

			{/* discount */}
			<fieldset className="mt-4 rounded-xl border border-border p-4">
				<legend className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Discount (time-limited)</legend>
				<div className="mt-2 grid grid-cols-2 gap-3">
					<label className="text-xs">
						<span className="text-muted-foreground">Applies to</span>
						<select
							value={disc?.applies_to ?? 'all'}
							onChange={(e) => setDisc((d) => ({ ...(d ?? blankDisc(model.id)), applies_to: e.target.value }))}
							className="mt-1 w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm outline-none focus:border-cyan-500"
						>
							<option value="all">All prices</option>
							<option value="input">Input</option>
							<option value="output">Output</option>
							<option value="cache_read">Cache read</option>
							<option value="cache_write">Cache write</option>
						</select>
					</label>
					<label className="text-xs">
						<span className="text-muted-foreground">Kind</span>
						<select
							value={disc?.kind ?? 'percent'}
							onChange={(e) => setDisc((d) => ({ ...(d ?? blankDisc(model.id)), kind: e.target.value }))}
							className="mt-1 w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm outline-none focus:border-cyan-500"
						>
							<option value="percent">Percent %</option>
							<option value="fixed">Fixed $ off / 1M</option>
						</select>
					</label>
					<PriceInput
						label={disc?.kind === 'fixed' ? 'Value ($/1M off)' : 'Value (% off)'}
						value={disc?.value != null ? String(disc.value) : ''}
						onChange={(v) => setDisc((d) => ({ ...(d ?? blankDisc(model.id)), value: v === '' ? 0 : Number(v) }))}
					/>
					<label className="text-xs">
						<span className="text-muted-foreground">Valid from</span>
						<input type="date" value={disc?.valid_from ?? ''} onChange={(e) => setDisc((d) => ({ ...(d ?? blankDisc(model.id)), valid_from: e.target.value }))} className="mt-1 w-full rounded-md border border-border bg-transparent px-2 py-1.5 font-data text-xs outline-none focus:border-cyan-500" />
					</label>
					<label className="text-xs">
						<span className="text-muted-foreground">Expires (valid until)</span>
						<input type="date" value={disc?.valid_to ?? ''} onChange={(e) => setDisc((d) => ({ ...(d ?? blankDisc(model.id)), valid_to: e.target.value }))} className="mt-1 w-full rounded-md border border-border bg-transparent px-2 py-1.5 font-data text-xs outline-none focus:border-cyan-500" />
						<span className="mt-0.5 block text-[11px] text-muted-foreground">Empty = never expires</span>
					</label>
					<button onClick={() => setDisc(null)} className="mt-5 justify-self-start rounded-lg border border-red-500/40 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10">
						Remove discount
					</button>
				</div>
			</fieldset>

			{/* rate limits */}
			<fieldset className="mt-4 rounded-xl border border-border p-4">
				<legend className="flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
					<Gauge size={12} /> Rate limits (empty = global defaults)
				</legend>
				<div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
					<NumInput label="Req / min" value={rl.rpm} onChange={(v) => setRl({ ...rl, rpm: v })} />
					<NumInput label="Req / hour" value={rl.rph} onChange={(v) => setRl({ ...rl, rph: v })} />
					<NumInput label="Req / day" value={rl.rpd} onChange={(v) => setRl({ ...rl, rpd: v })} />
					<NumInput label="Tokens / min" value={rl.tpm} onChange={(v) => setRl({ ...rl, tpm: v })} />
				</div>
			</fieldset>
		</ModalFrame>
	);
}

function blankDisc(modelId: string): DiscountRow {
	return { id: '', model_id: modelId, applies_to: 'all', kind: 'percent', value: 10, valid_from: new Date().toISOString().slice(0, 10), valid_to: '', active: true };
}

function PriceInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
	return (
		<label className="block text-xs">
			<span className="text-muted-foreground">{label}</span>
			<input
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder="—"
				inputMode="decimal"
				dir="ltr"
				className="mt-1 w-full rounded-md border border-border bg-transparent px-2 py-1.5 font-data text-sm tabular-nums outline-none focus:border-cyan-500"
			/>
		</label>
	);
}

function NumInput({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
	return (
		<label className="block text-xs">
			<span className="text-muted-foreground">{label}</span>
			<input
				value={value ?? ''}
				onChange={(e) => onChange(e.target.value.trim() === '' ? null : Number(e.target.value))}
				placeholder="∞"
				inputMode="numeric"
				dir="ltr"
				className="mt-1 w-full rounded-md border border-border bg-transparent px-2 py-1.5 font-data text-sm tabular-nums outline-none focus:border-cyan-500"
			/>
		</label>
	);
}

// ---------------- metadata modal ----------------
function MetaModal({ model, providers, onClose }: { model: AdminModelRow; providers: ProviderRow[]; onClose: () => void }) {
	const [name, setName] = useState(model.display_name);
	const [description, setDescription] = useState(model.description ?? '');
	const [quality, setQuality] = useState(model.quality_score?.toString() ?? '');
	const [featured, setFeatured] = useState(model.is_featured);
	const [visible, setVisible] = useState(model.enabled_for_users);
	const [context, setContext] = useState(model.context_window?.toString() ?? '');
	const [maxOut, setMaxOut] = useState<string>('');
	const [categoryId, setCategoryId] = useState<string>('');
	const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
	const [providerId, setProviderId] = useState(model.provider_id ?? '');
	const [vendorSlug, setVendorSlug] = useState(model.vendor_slug ?? '');
	const [vendors, setVendors] = useState<VendorRow[]>([]);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// max_output_tokens + current category aren't in the view row — fetch them
	useEffect(() => {
		void supabase.from('models').select('max_output_tokens,category_id,provider_id,vendor_slug').eq('id', model.id).maybeSingle()
			.then(({ data }) => {
				setMaxOut(data?.max_output_tokens != null ? String(data.max_output_tokens) : '');
				setCategoryId(data?.category_id ?? '');
				setProviderId((data as { provider_id: string | null } | null)?.provider_id ?? '');
				setVendorSlug((data as { vendor_slug: string | null } | null)?.vendor_slug ?? '');
			});
	}, [model.id]);

	// category picker list + vendor (brand) list
	useEffect(() => {
		void supabase
			.from('model_categories')
			.select('id,name')
			.order('sort_order')
			.then(({ data }) => setCategories((data ?? []) as Array<{ id: string; name: string }>));
		void supabase
			.from('ai_providers')
			.select('slug,display_name')
			.order('display_name')
			.then(({ data }) => setVendors((data ?? []) as VendorRow[]));
	}, []);

	async function save() {
		setBusy(true);
		setError(null);
		const q = quality.trim() === '' ? null : Number(quality);
		if (q != null && (q < 0 || q > 5)) {
			setError('Quality score must be 0–5.');
			setBusy(false);
			return;
		}
		const ctx = context.trim() === '' ? null : Number(context);
		if (ctx != null && (!Number.isFinite(ctx) || ctx <= 0)) {
			setError('Context window must be a positive token count.');
			setBusy(false);
			return;
		}
		const out = maxOut.trim() === '' ? null : Number(maxOut);
		const { error } = await supabase.from('models').update({
			display_name: name.trim() || model.upstream_model_id,
			description: description.trim() || null,
			quality_score: q,
			is_featured: featured,
			enabled_for_users: visible,
			context_window: ctx,
			max_output_tokens: out,
			category_id: categoryId || null,
			provider_id: providerId || null,
			vendor_slug: vendorSlug || null,
		}).eq('id', model.id);
		if (error) setError(error.message);
		else onClose();
		setBusy(false);
	}

	return (
		<ModalFrame title={`Edit — ${model.upstream_model_id}`} onClose={onClose} footer={
			<>
				<button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm">Cancel</button>
				<button onClick={save} disabled={busy} className="rounded-lg bg-cyan-600 px-5 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-40">
					{busy ? 'Saving…' : 'Save'}
				</button>
			</>
		}>
			{error && <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-2.5 text-sm text-red-400">{error}</div>}
			<label className="block text-xs">
				<span className="text-muted-foreground">Display name</span>
				<input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-cyan-500" />
			</label>
			<label className="mt-3 block text-xs">
				<span className="text-muted-foreground">Description</span>
				<textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} className="mt-1 w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-cyan-500" />
			</label>
			<div className="mt-3 grid grid-cols-2 gap-3">
				<PriceInput label="Context window (tokens)" value={context} onChange={setContext} />
				<PriceInput label="Max output tokens" value={maxOut} onChange={setMaxOut} />
				<PriceInput label="Quality score (0–5, stars)" value={quality} onChange={setQuality} />
				<label className="block text-xs">
					<span className="text-muted-foreground">Gateway provider (which connection serves this model)</span>
					<select value={providerId} onChange={(e) => setProviderId(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-cyan-500">
						<option value="">— unassigned —</option>
						{providers.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
					</select>
				</label>
				<label className="mt-3 block text-xs">
					<span className="text-muted-foreground">Vendor / brand (card logo &amp; grouping)</span>
					<select value={vendorSlug} onChange={(e) => setVendorSlug(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-cyan-500">
						<option value="">— none —</option>
						{vendors.map((v) => <option key={v.slug} value={v.slug}>{v.display_name}</option>)}
					</select>
				</label>
				<label className="block text-xs">
					<span className="text-muted-foreground">Category (where it appears on /models)</span>
					<select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-cyan-500">
						<option value="">— no category —</option>
						{categories.map((c) => <option key={c.id} value={c.id}>{c.name.replace(/^vendor:/, '')}</option>)}
					</select>
				</label>
				<label className="mt-5 flex items-center gap-2 text-sm">
					<input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} className="accent-cyan-500" />
					<EyeOff size={13} className="text-cyan-400" /> Visible to users
				</label>
				<label className="flex items-center gap-2 text-sm">
					<input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} className="accent-violet-500" />
					<Star size={13} className="fill-violet-400 text-violet-400" /> Recommended card
				</label>
			</div>
		</ModalFrame>
	);
}

// ---------------- custom model modal ----------------
function CustomModelModal({ onClose }: { onClose: () => void }) {
	const [models, setModels] = useState<Array<{ id: string; display_name: string; upstream_model_id: string; provider_id: string; vendor_slug: string | null; category_id: string | null; enabled_for_users: boolean; is_custom: boolean }>>([]);
	const [providers, setProviders] = useState<ProviderRow[]>([]);
	const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
	const [parentId, setParentId] = useState('');
	const [name, setName] = useState('');
	const [newId, setNewId] = useState('');
	const [prompt, setPrompt] = useState('');
	const [categoryId, setCategoryId] = useState('');
	const [visible, setVisible] = useState(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// every synced model can be a base — hidden ones included (admin RLS).
	// fetch in chunks: PostgREST caps single responses at 1000 rows.
	useEffect(() => {
		void (async () => {
			const all: unknown[] = [];
			for (let from = 0; from < 20_000; from += 1000) {
				const { data } = await supabase
					.from('models')
					.select('id,display_name,upstream_model_id,provider_id,vendor_slug,category_id,enabled_for_users,is_custom')
					.eq('is_custom', false)
					.order('display_name')
					.range(from, from + 999);
				if (!data?.length) break;
				all.push(...data);
				if (data.length < 1000) break;
			}
			setModels(all as typeof models);
			if (all.length) {
				const first = all[0] as { id: string; category_id: string | null };
				setParentId(first.id);
				setCategoryId(first.category_id ?? '');
			}
		})();
		void supabase.from('providers').select('id,display_name,kind').order('display_name')
			.then(({ data }) => setProviders((data ?? []) as ProviderRow[]));
		void supabase
			.from('model_categories')
			.select('id,name')
			.order('sort_order')
			.then(({ data }) => setCategories((data ?? []) as Array<{ id: string; name: string }>));
	}, []);

	async function create() {
		setBusy(true);
		setError(null);
		const id = newId.trim();
		if (!parentId || !name.trim() || !id) {
			setError('Pick a base model, then give the copy a new name and a new model id.');
			setBusy(false);
			return;
		}
		if (/\s/.test(id)) {
			setError('Model id cannot contain spaces (e.g. my-gpt-for-support).');
			setBusy(false);
			return;
		}
		const base = models.find((m) => m.id === parentId)!;

		// the new id must be globally unique — a clash would shadow the base model
		const { data: clash } = await supabase.from('models').select('id').eq('upstream_model_id', id).maybeSingle();
		if (clash) {
			setError(`Model id "${id}" already exists — pick another.`);
			setBusy(false);
			return;
		}

		let slug = id.replace(/[^a-zA-Z0-9._:-]/g, '-').replace(/^-+/, '');
		const { data: slugClash } = await supabase.from('models').select('id').eq('slug', slug).maybeSingle();
		if (slugClash) slug = `${slug}-custom`;

		const { error: insErr } = await supabase.from('models').insert({
			provider_id: base.provider_id,
			upstream_model_id: id,
			display_name: name.trim(),
			slug,
			is_custom: true,
			parent_model_id: base.id,
			system_prompt: prompt.trim() || null,
			vendor_slug: base.vendor_slug,
			category_id: categoryId || base.category_id,
			enabled_for_users: visible,
			usage_multiplier: 1,
		});
		if (insErr) {
			setError(insErr.message);
			setBusy(false);
			return;
		}
		setBusy(false);
		onClose();
	}

	return (
		<ModalFrame title="Custom model" onClose={onClose} footer={
			<>
				<button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm">Cancel</button>
				<button onClick={create} disabled={busy} className="flex items-center gap-2 rounded-lg bg-violet-600 px-5 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-40">
					<Sparkles size={14} /> {busy ? 'Creating…' : 'Create custom model'}
				</button>
			</>
		}>
			{error && <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-2.5 text-sm text-red-400">{error}</div>}
			<p className="mb-4 text-xs leading-relaxed text-muted-foreground">
				A copy of an existing model with its own id, name and system prompt. It appears in the API and dashboards under
				the new name; the original stays untouched. Price it from the table after creating.
			</p>
			<label className="block text-xs">
				<span className="text-muted-foreground">Base model</span>
				<select
					value={parentId}
					onChange={(e) => {
						setParentId(e.target.value);
						const base = models.find((m) => m.id === e.target.value);
						if (base) setCategoryId(base.category_id ?? '');
					}}
					className="mt-1 w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-cyan-500"
				>
					{models.map((m) => (
						<option key={m.id} value={m.id}>
							{m.display_name}
							{m.provider_id && ` — ${providers.find((p) => p.id === m.provider_id)?.display_name ?? 'provider'}`}
							{!m.enabled_for_users && ' (hidden)'}
						</option>
					))}
				</select>
			</label>
			<label className="mt-3 block text-xs">
				<span className="text-muted-foreground">Category (where it appears on /models)</span>
				<select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-cyan-500">
					<option value="">— inherit from base model —</option>
					{categories.map((c) => <option key={c.id} value={c.id}>{c.name.replace(/^vendor:/, '')}</option>)}
				</select>
			</label>
			<label className="mt-3 flex items-center gap-2 text-sm">
				<input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} className="accent-cyan-500" />
				Visible to users immediately <span className="text-xs text-muted-foreground">(uncheck to create it hidden)</span>
			</label>
			<label className="mt-3 block text-xs">
				<span className="text-muted-foreground">New display name</span>
				<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Support Agent GPT" className="mt-1 w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-cyan-500" />
			</label>
			<label className="mt-3 block text-xs">
				<span className="text-muted-foreground">New model id (what clients send)</span>
				<input value={newId} onChange={(e) => setNewId(e.target.value)} placeholder="e.g. support-agent-gpt" dir="ltr" className="mt-1 w-full rounded-md border border-border bg-transparent px-3 py-2 font-mono text-xs outline-none focus:border-cyan-500" />
			</label>
			<label className="mt-3 block text-xs">
				<span className="text-muted-foreground">System prompt (prepended to every request)</span>
				<textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={6} placeholder="You are a support agent for…" className="mt-1 w-full rounded-md border border-border bg-transparent px-3 py-2 font-mono text-xs outline-none focus:border-cyan-500" />
			</label>
		</ModalFrame>
	);
}

// ---------------- shared modal frame ----------------
function ModalFrame({ title, onClose, footer, children }: { title: string; onClose: () => void; footer: React.ReactNode; children: React.ReactNode }) {
	return (
		<div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
			<div className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-2xl border border-[var(--nx-border)] bg-[var(--nx-surface)] shadow-2xl">
				<header className="flex items-center justify-between border-b border-[var(--nx-border)] px-6 py-4">
					<h2 className="font-semibold">{title}</h2>
					<button onClick={onClose} className="rounded-lg p-1.5 text-[var(--nx-muted)] hover:bg-zinc-800/60"><X size={18} /></button>
				</header>
				<div className="overflow-y-auto px-6 py-4">{children}</div>
				<footer className="flex items-center justify-end gap-2 border-t border-[var(--nx-border)] px-6 py-4">{footer}</footer>
			</div>
		</div>
	);
}
