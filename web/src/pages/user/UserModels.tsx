import { useEffect, useMemo, useState } from 'react';
import { Boxes, Search, ArrowLeft, ArrowRight, CheckCircle2, BadgePercent } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { DashboardShell } from '../../components/DashboardShell';
import { PageHeader, Pill } from '../../components/console-kit';
import { ModelCard, type ModelCardData } from '../../components/ModelCard';
import { VENDOR_META } from '../../design-system/vendor-marks';

const PAGE_SIZE = 100;

export default function UserModels() {
	const [email, setEmail] = useState('');
	const [models, setModels] = useState<ModelCardData[]>([]);
	const [loading, setLoading] = useState(true);
	const [query, setQuery] = useState('');
	const [vendor, setVendor] = useState('any');
	const [page, setPage] = useState(1);

	useEffect(() => {
		void (async () => {
			const { data: { user } } = await supabase.auth.getUser();
			if (user) setEmail(user.email ?? '');
			// page through the enabled, priced catalog (PostgREST caps at 1000)
			const all: unknown[] = [];
			for (let from = 0; from < 20_000; from += 1000) {
				const { data } = await supabase
					.from('models_public_view')
					.select('id,slug,display_name,vendor_slug,vendor_name,context_window,payg_enabled,usage_multiplier,enabled_for_users,is_priced,is_featured,is_custom,input_modalities,output_modalities,supports_reasoning,input_price,output_price,cache_read_price,discount_percent,quality_score,tags')
					.eq('is_priced', true)
					.order('display_name')
					.range(from, from + 999);
				if (!data?.length) break;
				all.push(...data);
				if (data.length < 1000) break;
			}
			setModels(all as unknown as ModelCardData[]);
			setLoading(false);
		})();
	}, []);

	const vendors = useMemo(() => {
		const present = [...new Set(models.map((m) => m.vendor_slug ?? 'other'))];
		return present.sort((a, b) => (VENDOR_META[a]?.label ?? a).localeCompare(VENDOR_META[b]?.label ?? b));
	}, [models]);

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		return models.filter((m) => {
			if (q && !m.display_name.toLowerCase().includes(q)) return false;
			if (vendor !== 'any' && (m.vendor_slug ?? 'other') !== vendor) return false;
			return true;
		});
	}, [models, query, vendor]);

	useEffect(() => { setPage(1); }, [query, vendor]);

	const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
	const safePage = Math.min(page, pageCount);
	const paged = useMemo(
		() => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
		[filtered, safePage],
	);
	const discounted = paged.filter((m) => Number(m.discount_percent ?? 0) > 0);
	const rest = paged.filter((m) => Number(m.discount_percent ?? 0) <= 0);

	return (
		<DashboardShell variant="user" email={email}>
			<div className="space-y-6">
				<PageHeader
					title="Models & Pricing"
					subtitle="Every model you can use right now — plan weighting and Pay-As-You-Go prices side by side."
				/>

				{/* filters */}
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
					<select
						value={vendor}
						onChange={(e) => setVendor(e.target.value)}
						className="rounded-lg border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-cyan-500"
					>
						<option value="any">All vendors</option>
						{vendors.map((v) => (
							<option key={v} value={v}>{VENDOR_META[v]?.label ?? v}</option>
						))}
					</select>
					<Pill tone="gray">{filtered.length} models</Pill>
				</div>

				{/* grid */}
				{loading ? (
					<p className="py-16 text-center text-sm text-[var(--nx-muted)]">Loading…</p>
				) : paged.length === 0 ? (
					<div className="rounded-2xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-12 text-center">
						<Boxes size={26} className="mx-auto mb-3 text-[var(--nx-muted)]" />
						<p className="text-sm text-[var(--nx-muted)]">No models match your filters.</p>
					</div>
				) : (
					<>
						{discounted.length > 0 && (
							<div>
								<h2 className="mb-3 flex items-center gap-2 font-data text-xs font-semibold uppercase tracking-[0.18em] text-amber-400">
									<BadgePercent size={13} /> Promotional
								</h2>
								<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
									{discounted.map((m) => <ModelCard key={m.id} model={m} />)}
								</div>
							</div>
						)}
						{rest.length > 0 && (
							<div>
								{discounted.length > 0 && (
									<h2 className="mb-3 mt-6 flex items-center gap-2 font-data text-xs font-semibold uppercase tracking-[0.18em] text-[var(--nx-muted)]">
										<CheckCircle2 size={13} /> All models
									</h2>
								)}
								<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
									{rest.map((m) => <ModelCard key={m.id} model={m} />)}
								</div>
							</div>
						)}
					</>
				)}

				{/* pagination */}
				{pageCount > 1 && (
					<div className="flex items-center justify-between">
						<Pill tone="gray">Page {safePage} of {pageCount}</Pill>
						<div className="flex gap-2">
							<button
								onClick={() => { setPage(Math.max(1, safePage - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
								disabled={safePage <= 1}
								className="rounded-lg border border-border px-3 py-1.5 text-sm disabled:opacity-40 hover:border-cyan-500/50"
							>
								<ArrowLeft size={14} className="rtl:rotate-180" />
							</button>
							<button
								onClick={() => { setPage(Math.min(pageCount, safePage + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
								disabled={safePage >= pageCount}
								className="rounded-lg border border-border px-3 py-1.5 text-sm disabled:opacity-40 hover:border-cyan-500/50"
							>
								<ArrowRight size={14} className="rtl:rotate-180" />
							</button>
						</div>
					</div>
				)}
			</div>
		</DashboardShell>
	);
}
