import { useEffect, useMemo, useState } from 'react';
import { Activity, DollarSign, Zap, Timer, Gauge } from 'lucide-react';
import {
	AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { supabase } from '../../lib/supabase';
import { DashboardShell } from '../../components/DashboardShell';
import { TimeRangeFilter } from '../../components/TimeRangeFilter';
import { PageHeader, KpiCard, Pill, EmptyState, compactTokens } from '../../components/console-kit';

interface LogRow {
	id: number;
	model_id: string | null;
	upstream_model: string;
	tokens_in: number;
	tokens_out: number;
	weighted_tokens: number;
	cost_usd: number | string | null;
	billing_mode: 'plan' | 'wallet';
	latency_ms: number;
	ttft_ms: number | null;
	status: number;
	error_code: string | null;
	created_at: string;
	models?: { display_name: string; vendor_slug: string | null } | null;
}

const RANGES: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90, all: 60 };

export default function Usage() {
	const [email, setEmail] = useState('');
	const [range, setRange] = useState<'7d' | '30d' | '90d' | 'all'>('30d');
	const [logs, setLogs] = useState<LogRow[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		void (async () => {
			setLoading(true);
			const { data: { user } } = await supabase.auth.getUser();
			if (user) setEmail(user.email ?? '');
			const days = RANGES[range] ?? 30;
			const since = new Date(Date.now() - days * 86_400_000).toISOString();
			const { data } = await supabase
				.from('request_logs')
				.select('id,model_id,upstream_model,tokens_in,tokens_out,weighted_tokens,cost_usd,billing_mode,latency_ms,ttft_ms,status,error_code,created_at,models(display_name,vendor_slug)')
				.eq('user_id', user!.id)
				.gte('created_at', since)
				.order('created_at', { ascending: false })
				.limit(10000);
			setLogs((data ?? []) as unknown as LogRow[]);
			setLoading(false);
		})();
	}, [range]);

	const stats = useMemo(() => {
		let cost = 0, weighted = 0, requests = logs.length, latencySum = 0, ttftSum = 0, ttftN = 0, errors = 0;
		for (const l of logs) {
			cost += Number(l.cost_usd ?? 0);
			weighted += Number(l.weighted_tokens ?? 0);
			latencySum += l.latency_ms;
			if (l.ttft_ms && l.ttft_ms > 0) { ttftSum += l.ttft_ms; ttftN++; }
			if (l.status >= 400) errors++;
		}
		const byModel = new Map<string, { name: string; requests: number; tokensIn: number; tokensOut: number; cost: number; weighted: number; last: string }>();
		for (const l of logs) {
			const key = l.model_id ?? l.upstream_model;
			const name = l.models?.display_name ?? l.upstream_model;
			const row = byModel.get(key) ?? { name, requests: 0, tokensIn: 0, tokensOut: 0, cost: 0, weighted: 0, last: l.created_at };
			row.requests++;
			row.tokensIn += l.tokens_in;
			row.tokensOut += l.tokens_out;
			row.cost += Number(l.cost_usd ?? 0);
			row.weighted += Number(l.weighted_tokens ?? 0);
			if (l.created_at > row.last) row.last = l.created_at;
			byModel.set(key, row);
		}
		const byDay = new Map<string, { day: string; cost: number; weighted: number }>();
		for (const l of logs) {
			const day = l.created_at.slice(0, 10);
			const row = byDay.get(day) ?? { day, cost: 0, weighted: 0 };
			row.cost += Number(l.cost_usd ?? 0);
			row.weighted += Number(l.weighted_tokens ?? 0);
			byDay.set(day, row);
		}
		return {
			cost, weighted, requests,
			avgLatency: requests ? latencySum / requests : 0,
			avgTtft: ttftN ? ttftSum / ttftN : 0,
			errors,
			models: [...byModel.values()].sort((a, b) => b.cost - a.cost || b.requests - a.requests),
			daily: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
		};
	}, [logs]);

	return (
		<DashboardShell variant="user" email={email}>
			<div className="space-y-6">
				<PageHeader
					title="Usage"
					subtitle="Full consumption per model — spend, tokens, and your latest requests."
					actions={<TimeRangeFilter value={range} onChange={setRange} />}
				/>

				<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
					<KpiCard label="Wallet spend" value={`$${stats.cost.toFixed(4)}`} icon={<DollarSign size={15} />} sub="Pay-As-You-Go requests" />
					<KpiCard label="Weighted tokens" value={compactTokens(stats.weighted)} icon={<Zap size={15} />} tone="violet" sub="plan-billed consumption" />
					<KpiCard label="Requests" value={stats.requests} icon={<Activity size={15} />} sub={`${stats.errors} failed`} tone={stats.errors > 0 ? 'amber' : 'teal'} />
					<KpiCard
						label="Avg latency"
						value={`${(stats.avgLatency / 1000).toFixed(2)}s`}
						icon={<Timer size={15} />}
						tone="gray"
						sub={stats.avgTtft ? `TTFT ${(stats.avgTtft / 1000).toFixed(2)}s` : undefined}
					/>
				</div>

				{/* daily chart */}
				<section className="rounded-xl border border-border bg-[var(--nx-surface)] p-5">
					<h2 className="mb-4 text-sm font-semibold">Daily consumption</h2>
					<div className="h-56">
						<ResponsiveContainer width="100%" height="100%">
							<AreaChart data={stats.daily}>
								<defs>
									<linearGradient id="usageCost" x1="0" y1="0" x2="0" y2="1">
										<stop offset="0%" stopColor="#22d3ee" stopOpacity={0.35} />
										<stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
									</linearGradient>
								</defs>
								<CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
								<XAxis dataKey="day" tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} axisLine={false} />
								<YAxis tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
								<Tooltip
									contentStyle={{ background: '#0c0f14', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
									formatter={((v: unknown, k: string) => [k === 'cost' ? `$${Number(v).toFixed(4)}` : compactTokens(Number(v)), k === 'cost' ? 'Wallet spend' : 'Weighted tokens']) as never}
								/>
								<Area type="monotone" dataKey="weighted" stroke="#a78bfa" fill="transparent" strokeWidth={1.5} name="weighted" />
								<Area type="monotone" dataKey="cost" stroke="#22d3ee" fill="url(#usageCost)" strokeWidth={1.5} name="cost" />
							</AreaChart>
						</ResponsiveContainer>
					</div>
				</section>

				{/* per model */}
				<section>
					<h2 className="mb-3 font-data text-xs font-semibold uppercase tracking-[0.18em] text-[var(--nx-muted)]">Per model</h2>
					{stats.models.length === 0 ? (
						<EmptyState icon={<Gauge size={26} />} title={loading ? 'Loading…' : 'No usage in this period'} hint="Requests through your API keys appear here with their token and dollar cost." />
					) : (
						<div className="overflow-x-auto rounded-xl border border-[var(--nx-border)]">
							<table className="w-full min-w-[680px] text-sm">
								<thead className="bg-zinc-900/60 font-data text-[11px] uppercase tracking-wider text-[var(--nx-muted)]">
									<tr>
										<th className="px-4 py-3 text-start">Model</th>
										<th className="px-4 py-3 text-start">Requests</th>
										<th className="px-4 py-3 text-start">Tokens in</th>
										<th className="px-4 py-3 text-start">Tokens out</th>
										<th className="px-4 py-3 text-start">Weighted</th>
										<th className="px-4 py-3 text-start">Cost</th>
										<th className="px-4 py-3 text-start">Last used</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-[var(--nx-border)]">
									{stats.models.map((m) => (
										<tr key={m.name} className="transition-colors hover:bg-cyan-500/[0.03]">
											<td className="max-w-52 truncate px-4 py-3 font-medium">{m.name}</td>
											<td className="px-4 py-3 font-data text-xs tabular-nums">{m.requests}</td>
											<td className="px-4 py-3 font-data text-xs tabular-nums">{compactTokens(m.tokensIn)}</td>
											<td className="px-4 py-3 font-data text-xs tabular-nums">{compactTokens(m.tokensOut)}</td>
											<td className="px-4 py-3 font-data text-xs tabular-nums">{compactTokens(m.weighted)}</td>
											<td className="px-4 py-3 font-data text-xs tabular-nums text-cyan-300">{m.cost > 0 ? `$${m.cost.toFixed(4)}` : '—'}</td>
											<td className="px-4 py-3 text-xs text-[var(--nx-muted)]">{m.last.slice(0, 10)}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</section>

				{/* recent requests */}
				<section>
					<h2 className="mb-3 font-data text-xs font-semibold uppercase tracking-[0.18em] text-[var(--nx-muted)]">Latest requests</h2>
					<div className="overflow-x-auto rounded-xl border border-[var(--nx-border)]">
						<table className="w-full min-w-[720px] text-sm">
							<thead className="bg-zinc-900/60 font-data text-[11px] uppercase tracking-wider text-[var(--nx-muted)]">
								<tr>
									<th className="px-4 py-3 text-start">Model</th>
									<th className="px-4 py-3 text-start">Status</th>
									<th className="px-4 py-3 text-start">Billing</th>
									<th className="px-4 py-3 text-start">In / Out</th>
									<th className="px-4 py-3 text-start">Cost</th>
									<th className="px-4 py-3 text-start">Latency</th>
									<th className="px-4 py-3 text-start">Time</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-[var(--nx-border)]">
								{logs.slice(0, 25).map((l) => (
									<tr key={l.id} className="transition-colors hover:bg-cyan-500/[0.03]">
										<td className="max-w-44 truncate px-4 py-2.5">{l.models?.display_name ?? l.upstream_model}</td>
										<td className="px-4 py-2.5">
											<Pill tone={l.status < 400 ? 'green' : l.status < 500 ? 'amber' : 'red'}>
												{l.status}{l.error_code ? ` · ${l.error_code}` : ''}
											</Pill>
										</td>
										<td className="px-4 py-2.5">
											<Pill tone={l.billing_mode === 'wallet' ? 'teal' : 'violet'}>
												{l.billing_mode === 'wallet' ? 'PAYG' : 'Plan'}
											</Pill>
										</td>
										<td className="px-4 py-2.5 font-data text-xs tabular-nums">{compactTokens(l.tokens_in)} / {compactTokens(l.tokens_out)}</td>
										<td className="px-4 py-2.5 font-data text-xs tabular-nums">{Number(l.cost_usd ?? 0) > 0 ? `$${Number(l.cost_usd).toFixed(5)}` : '—'}</td>
										<td className="px-4 py-2.5 font-data text-xs tabular-nums">{(l.latency_ms / 1000).toFixed(2)}s</td>
										<td className="px-4 py-2.5 text-xs text-[var(--nx-muted)]">{new Date(l.created_at).toLocaleString()}</td>
									</tr>
								))}
								{logs.length === 0 && (
									<tr>
										<td colSpan={7} className="px-4 py-10 text-center text-sm text-[var(--nx-muted)]">
											{loading ? 'Loading…' : 'No requests in this period.'}
										</td>
									</tr>
								)}
							</tbody>
						</table>
					</div>
				</section>
			</div>
		</DashboardShell>
	);
}
