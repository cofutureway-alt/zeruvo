import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { DashboardShell } from '../../components/DashboardShell';
import { ModelUsageTable } from '../../components/ModelUsageTable';
import { TimeRangeFilter } from '../../components/TimeRangeFilter';
import { useModelUsage, type TimeRange } from '../../hooks/useModelUsage';
import { TrendingUp, Wallet, ShoppingCart, Trophy, Search } from 'lucide-react';
import { edgeCall } from '../../lib/admin-api';

interface PlanStat {
	id: string;
	name: string;
	count: number;
	revenueEgp: number;
	revenueUsd: number;
}

/** Per-user token usage row for the admin filterable breakdown. */
interface UserUsageRow {
	user_id: string;
	email: string;
	requests: number;
	tokens_in: number;
	tokens_out: number;
	weighted_tokens: number;
}

export default function Admin() {
	const [email, setEmail] = useState('');
	const [range, setRange] = useState<TimeRange>('30d');
	const { data: usage, loading, total } = useModelUsage(range);
	const [stats, setStats] = useState<{ incomeEgp: number; incomeUsd: number; sales: number; top: PlanStat[] } | null>(null);
	const [statsLoading, setStatsLoading] = useState(true);
	// per-user usage breakdown (admin only)
	const [userUsage, setUserUsage] = useState<UserUsageRow[]>([]);
	const [userUsageLoading, setUserUsageLoading] = useState(true);
	const [userQuery, setUserQuery] = useState('');

	useEffect(() => {
		void supabase.auth.getUser().then(({ data }: { data: { user?: { email?: string } | null } }) =>
			setEmail(data.user?.email ?? ''));
	}, []);

	// sales stats + per-user usage, re-fetched when the range changes
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

	// per-user token usage (request_logs fresh + usage_daily_agg archived)
	useEffect(() => {
		let cancelled = false;
		void (async () => {
			setUserUsageLoading(true);
			const since = new Date();
			const days = range === 'all' ? null : range === '7d' ? 7 : range === '30d' ? 30 : 90;
			if (days) since.setDate(since.getDate() - days);

			const byUser = new Map<string, { requests: number; tokens_in: number; tokens_out: number; weighted_tokens: number }>();
			const add = (uid: string, r: { requests: number; tokens_in: number; tokens_out: number; weighted_tokens: number }) => {
				const agg = byUser.get(uid) ?? { requests: 0, tokens_in: 0, tokens_out: 0, weighted_tokens: 0 };
				agg.requests += r.requests;
				agg.tokens_in += r.tokens_in;
				agg.tokens_out += r.tokens_out;
				agg.weighted_tokens += r.weighted_tokens;
				byUser.set(uid, agg);
			};

			// fresh logs
			{
				let q = supabase.from('request_logs').select('user_id,tokens_in,tokens_out,weighted_tokens');
				if (days) q = q.gte('created_at', since.toISOString());
				const { data: rows } = await q;
				if (cancelled) return;
				for (const r of rows ?? []) {
					add(r.user_id, {
						requests: 1,
						tokens_in: Number(r.tokens_in ?? 0),
						tokens_out: Number(r.tokens_out ?? 0),
						weighted_tokens: Number(r.weighted_tokens ?? 0),
					});
				}
			}
			// archived aggregates
			{
				let q = supabase.from('usage_daily_agg').select('user_id,requests,tokens_in,tokens_out,weighted_tokens');
				if (days) q = q.gte('utc_date', since.toISOString().slice(0, 10));
				const { data: rows } = await q;
				if (cancelled) return;
				for (const r of rows ?? []) {
					add(r.user_id, {
						requests: Number(r.requests ?? 0),
						tokens_in: Number(r.tokens_in ?? 0),
						tokens_out: Number(r.tokens_out ?? 0),
						weighted_tokens: Number(r.weighted_tokens ?? 0),
					});
				}
			}

			// resolve emails via the admin users edge function
			const ids = [...byUser.keys()];
			const emails = new Map<string, string>();
			if (ids.length) {
				const res = await edgeCall<{ users?: Array<{ id: string; email: string }>; error?: string }>(
					'admin-users-list', {},
				).catch(() => null);
				for (const u of res?.users ?? []) emails.set(u.id, u.email);
			}

			const result: UserUsageRow[] = ids.map((uid) => ({
				user_id: uid,
				email: emails.get(uid) ?? uid.slice(0, 8),
				...byUser.get(uid)!,
			})).sort((a, b) => b.weighted_tokens - a.weighted_tokens);

			setUserUsage(result);
			setUserUsageLoading(false);
		})();
		return () => { cancelled = true; };
	}, [range]);

	const filteredUsers = userUsage.filter((u) =>
		!userQuery.trim() || u.email.toLowerCase().includes(userQuery.toLowerCase()));

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

				{/* Per-user usage breakdown */}
				<section className="space-y-4">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div>
							<h2 className="font-display text-lg font-semibold">Per-user token usage</h2>
							<p className="text-sm text-[var(--nx-muted)]">Totals across every user's models.</p>
						</div>
						<label className="relative block w-full max-w-xs">
							<Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-[var(--nx-muted)]" />
							<input
								value={userQuery}
								onChange={(e) => setUserQuery(e.target.value)}
								placeholder="Filter by email…"
								className="w-full rounded-lg border border-[var(--nx-border)] bg-transparent py-2 pe-3 ps-9 text-sm outline-none focus:border-cyan-500"
							/>
						</label>
					</div>
					<UsersTable rows={filteredUsers} loading={userUsageLoading} />
				</section>
			</div>
		</DashboardShell>
	);
}

function UsersTable({ rows, loading }: { rows: UserUsageRow[]; loading: boolean }) {
	if (loading) return <div className="nx-skeleton h-48 rounded-xl" aria-busy="true" />;
	return (
		<div className="overflow-x-auto rounded-xl border border-[var(--nx-border)]">
			<table className="w-full min-w-[620px] text-sm">
				<thead className="bg-zinc-900/60 text-xs uppercase tracking-wide text-[var(--nx-muted)]">
					<tr>
						<th className="px-4 py-3 text-start">User</th>
						<th className="px-4 py-3 text-end">Requests</th>
						<th className="px-4 py-3 text-end">Tokens In</th>
						<th className="px-4 py-3 text-end">Tokens Out</th>
						<th className="px-4 py-3 text-end">Total Tokens</th>
						<th className="px-4 py-3 text-end">Weighted</th>
					</tr>
				</thead>
				<tbody className="divide-y divide-[var(--nx-border)]">
					{rows.map((u) => (
						<tr key={u.user_id}>
							<td className="px-4 py-2.5 font-mono text-xs">{u.email}</td>
							<td className="px-4 py-2.5 text-end tabular-nums">{u.requests.toLocaleString()}</td>
							<td className="px-4 py-2.5 text-end tabular-nums">{u.tokens_in.toLocaleString()}</td>
							<td className="px-4 py-2.5 text-end tabular-nums">{u.tokens_out.toLocaleString()}</td>
							<td className="px-4 py-2.5 text-end font-medium tabular-nums">{(u.tokens_in + u.tokens_out).toLocaleString()}</td>
							<td className="px-4 py-2.5 text-end tabular-nums">{u.weighted_tokens.toLocaleString()}</td>
						</tr>
					))}
					{rows.length === 0 && (
						<tr>
							<td colSpan={6} className="px-4 py-12 text-center text-sm text-[var(--nx-muted)]">
								No usage data for this period.
							</td>
						</tr>
					)}
				</tbody>
			</table>
		</div>
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
