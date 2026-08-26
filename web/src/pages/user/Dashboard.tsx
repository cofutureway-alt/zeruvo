import { useEffect, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { supabase } from '../../lib/supabase';
import { DashboardShell } from '../../components/DashboardShell';

interface Sub {
	expires_at: string;
	plans: { name: Record<string, string>; daily_weighted_tokens: number } | null;
}

export default function Dashboard() {
	const [email, setEmail] = useState('');
	const [consumed, setConsumed] = useState(0);
	const [reserved, setReserved] = useState(0);
	const [allowance, setAllowance] = useState(0);
	const [planName, setPlanName] = useState('—');
	const [expires, setExpires] = useState('—');
	const [chartData, setChartData] = useState<Array<{ date: string; consumed: number }>>([]);

	useEffect(() => {
		void (async () => {
			const { data: { user } } = await supabase.auth.getUser();
			if (!user) return;
			setEmail(user.email ?? '');

			const today = new Date().toISOString().slice(0, 10);
			const [{ data: usage }, { data: sub }] = await Promise.all([
				supabase
					.from('daily_usage')
					.select('reserved_weighted, consumed_weighted')
					.eq('user_id', user.id)
					.eq('utc_date', today)
					.maybeSingle(),
				supabase
					.from('subscriptions')
					.select('expires_at, plans(name, daily_weighted_tokens)')
					.eq('user_id', user.id)
					.eq('status', 'active')
					.gt('expires_at', new Date().toISOString())
					.maybeSingle(),
			]);

			setConsumed(usage?.consumed_weighted ?? 0);
			setReserved(usage?.reserved_weighted ?? 0);
			const s = sub as unknown as Sub | null;
			const allow = s?.plans?.daily_weighted_tokens ?? 0;
			setAllowance(allow);
			setPlanName(s?.plans?.name?.en ?? '—');
			setExpires(s?.expires_at?.slice(0, 10) ?? '—');

			// 14-day chart with zero-filled gaps
			const since = new Date(Date.now() - 13 * 86_400_000).toISOString().slice(0, 10);
			const { data: rows } = await supabase
				.from('daily_usage')
				.select('utc_date, consumed_weighted')
				.eq('user_id', user.id)
				.gte('utc_date', since)
				.order('utc_date');
			const byDate = new Map((rows ?? []).map((r) => [r.utc_date, r.consumed_weighted]));
			const points = [];
			for (let i = 13; i >= 0; i--) {
				const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
				points.push({ date: d.slice(5), consumed: Number(byDate.get(d) ?? 0) });
			}
			setChartData(points);
		})();
	}, []);

	const pct = allowance > 0 ? Math.min((consumed / allowance) * 100, 100) : 0;

	return (
		<DashboardShell variant="user" email={email}>
			<div className="space-y-6">
				<h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>

				<div className="rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-5">
					<div className="mb-2 flex items-center justify-between text-sm">
						<span className="font-medium">Today's quota</span>
						<span className="tabular-nums text-[var(--nx-muted)]">
							{consumed.toLocaleString()} / {allowance.toLocaleString()}
						</span>
					</div>
					<div className="h-2.5 overflow-hidden rounded-full bg-zinc-800">
						<div
							className={`h-full rounded-full transition-all ${
								pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-indigo-500'
							}`}
							style={{ width: `${pct}%` }}
						/>
					</div>
					{pct >= 80 && (
						<p className="mt-2 text-xs text-amber-400">You have used {pct.toFixed(0)}% of today's allowance.</p>
					)}
				</div>

				<div className="rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-5">
					<div className="mb-3 flex items-center justify-between">
						<h3 className="text-sm font-medium">Last 14 days</h3>
						<span className="text-xs tabular-nums text-[var(--nx-muted)]">
							daily limit {allowance.toLocaleString()}
						</span>
					</div>
					<div className="h-48">
						<ResponsiveContainer width="100%" height="100%">
							<AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
								<defs>
									<linearGradient id="gC" x1="0" y1="0" x2="0" y2="1">
										<stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
										<stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
									</linearGradient>
								</defs>
								<CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
								<XAxis dataKey="date" tick={{ fill: '#a1a1aa', fontSize: 11 }} axisLine={false} tickLine={false} />
								<YAxis tick={{ fill: '#a1a1aa', fontSize: 11 }} axisLine={false} tickLine={false} width={56} />
								<Tooltip
									contentStyle={{ background: '#111113', border: '1px solid #27272a', borderRadius: 8, fontSize: 12 }}
									formatter={(v) => Number(v).toLocaleString()}
								/>
								<Area type="monotone" dataKey="consumed" stroke="#818cf8" strokeWidth={2} fill="url(#gC)" />
							</AreaChart>
						</ResponsiveContainer>
					</div>
				</div>

				{!allowance && (
					<div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-amber-500/40 bg-amber-500/5 p-5">
						<div>
							<h3 className="font-display font-semibold text-amber-400">You're not subscribed to any plan</h3>
							<p className="mt-1 text-sm text-[var(--nx-muted)]">
								The API rejects requests until you subscribe. Pick a plan to get a daily weighted-token allowance.
							</p>
						</div>
						<a
							href="/dashboard/plans"
							className="rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-[0_0_24px_rgba(139,124,255,0.25)] hover:bg-indigo-500"
						>
							Browse plans
						</a>
					</div>
				)}

				<div className="grid gap-4 sm:grid-cols-3">
					<Card title="Plan">
						<p className={`text-xl font-semibold ${planName === '—' ? 'text-amber-400' : ''}`}>{planName}</p>
					</Card>
					<Card title="Renews / expires">
						<p className="text-xl font-semibold tabular-nums">{expires}</p>
					</Card>
					<Card title="Reserved (in-flight)">
						<p className="text-xl font-semibold tabular-nums">{reserved.toLocaleString()}</p>
					</Card>
				</div>
			</div>
		</DashboardShell>
	);
}

function Card(props: { title: string; children: React.ReactNode }) {
	return (
		<div className="rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-5">
			<p className="mb-2 text-sm text-[var(--nx-muted)]">{props.title}</p>
			{props.children}
		</div>
	);
}
