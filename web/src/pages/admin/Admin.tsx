import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { DashboardShell } from '../../components/DashboardShell';
import { ModelUsageTable } from '../../components/ModelUsageTable';
import { TimeRangeFilter } from '../../components/TimeRangeFilter';
import { useModelUsage, type TimeRange } from '../../hooks/useModelUsage';
import { TrendingUp, Wallet, ShoppingCart, Trophy } from 'lucide-react';

interface PlanStat {
	id: string;
	name: string;
	count: number;
	revenueEgp: number;
	revenueUsd: number;
}

export default function Admin() {
	const [email, setEmail] = useState('');
	const [range, setRange] = useState<TimeRange>('30d');
	const { data: usage, loading, total } = useModelUsage(range);
	const [stats, setStats] = useState<{ incomeEgp: number; incomeUsd: number; sales: number; top: PlanStat[] } | null>(null);
	const [statsLoading, setStatsLoading] = useState(true);

	useEffect(() => {
		void supabase.auth.getUser().then(({ data: { user } }) => setEmail(user?.email ?? ''));
	}, []);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			setStatsLoading(true);
			let q = supabase.from('payments').select('amount_egp,amount_usd_display,meta,created_at').eq('status', 'paid');
			if (range !== 'all') {
				const since = new Date();
				const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
				since.setDate(since.getDate() - days);
				q = q.gte('created_at', since.toISOString());
			}
			const { data } = await q;
			if (cancelled) return;

			let incomeEgp = 0, incomeUsd = 0, sales = 0;
			const byPlan = new Map<string, { count: number; egp: number; usd: number }>();
			for (const p of data ?? []) {
				incomeEgp += Number(p.amount_egp);
				incomeUsd += Number(p.amount_usd_display);
				sales += 1;
				const pid = (p.meta as { plan_id?: string } | null)?.plan_id;
				if (!pid) continue;
				const agg = byPlan.get(pid) ?? { count: 0, egp: 0, usd: 0 };
				agg.count += 1; agg.egp += Number(p.amount_egp); agg.usd += Number(p.amount_usd_display);
				byPlan.set(pid, agg);
			}

			const topIds = [...byPlan.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 5).map(([id]) => id);
			const planNames = new Map<string, string>();
			if (topIds.length) {
				const { data: plans } = await supabase.from('plans').select('id,name').in('id', topIds);
				for (const pl of plans ?? []) planNames.set(pl.id, (pl.name as { en?: string })?.en ?? '—');
			}
			const top: PlanStat[] = [...byPlan.entries()]
				.sort((a, b) => b[1].count - a[1].count)
				.slice(0, 5)
				.map(([id, a]) => ({ id, name: planNames.get(id) ?? '—', count: a.count, revenueEgp: a.egp, revenueUsd: a.usd }));

			setStats({ incomeEgp, incomeUsd, sales, top });
			setStatsLoading(false);
		})();
		return () => { cancelled = true; };
	}, [range]);

	return (
		<DashboardShell variant="admin" email={email}>
			<div className="space-y-6">
				<header>
					<h1 className="text-2xl font-semibold tracking-tight">Admin Console</h1>
					<p className="mt-0.5 max-w-xl text-sm text-[var(--nx-muted)]">
						Manage providers, model catalogs, plans, users, payments, coupons, announcements and
						payment gateways from the sidebar.
					</p>
				</header>

				{/* Sales & revenue */}
				<section className="space-y-4">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div>
							<h2 className="font-display text-lg font-semibold">Sales & revenue</h2>
							<p className="text-sm text-[var(--nx-muted)]">Confirmed payments within the selected period.</p>
						</div>
						<TimeRangeFilter value={range} onChange={setRange} />
					</div>

					{statsLoading || !stats ? (
						<div className="grid gap-4 sm:grid-cols-3" aria-busy="true">
							{Array.from({ length: 3 }).map((_, i) => <div key={i} className="nx-skeleton h-24 rounded-xl" />)}
						</div>
					) : (
						<>
							<div className="grid gap-4 sm:grid-cols-3">
								<StatCard icon={Wallet} title="Revenue (EGP)" value={`${stats.incomeEgp.toLocaleString(undefined, { maximumFractionDigits: 2 })} EGP`} />
								<StatCard icon={TrendingUp} title="Revenue (USD)" value={`$${stats.incomeUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
								<StatCard icon={ShoppingCart} title="Successful sales" value={stats.sales.toLocaleString()} />
							</div>

							<div className="rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-5">
								<h3 className="mb-3 flex items-center gap-2 text-sm font-medium">
									<Trophy size={15} className="text-amber-400" />
									Top-selling plans
								</h3>
								{stats.top.length === 0 ? (
									<p className="py-6 text-center text-sm text-[var(--nx-muted)]">No sales in this period yet.</p>
								) : (
									<ul className="divide-y divide-[var(--nx-border)]">
										{stats.top.map((t) => (
											<li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
												<span className="min-w-0 font-medium">{t.name}</span>
												<span className="tabular-nums text-[var(--nx-muted)]">
													{t.count} sale{t.count === 1 ? '' : 's'} · {t.revenueEgp.toLocaleString(undefined, { maximumFractionDigits: 0 })} EGP · ${t.revenueUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
												</span>
											</li>
										))}
									</ul>
								)}
							</div>
						</>
					)}
				</section>

				{/* Model analytics */}
				<section className="space-y-4">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div>
							<h2 className="font-display text-lg font-semibold">Model analytics</h2>
							<p className="text-sm text-[var(--nx-muted)]">Usage breakdown across all users by model.</p>
						</div>
						<TimeRangeFilter value={range} onChange={setRange} />
					</div>

					<div className="grid gap-4 sm:grid-cols-3">
						<StatCard title="Total requests" value={total.requests.toLocaleString()} />
						<StatCard title="Total tokens (in)" value={total.tokens_in.toLocaleString()} />
						<StatCard title="Total weighted tokens" value={total.weighted_tokens.toLocaleString()} />
					</div>

					<ModelUsageTable data={usage} loading={loading} showProvider total={total} />
				</section>
			</div>
		</DashboardShell>
	);
}

function StatCard({ title, value, icon: Icon }: { title: string; value: string; icon?: typeof Wallet }) {
	return (
		<div className="rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-5">
			<p className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wide text-[var(--nx-muted)]">
				{Icon && <Icon size={13} />}
				{title}
			</p>
			<p className="text-xl font-semibold tabular-nums">{value}</p>
		</div>
	);
}
