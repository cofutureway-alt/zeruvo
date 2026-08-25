'use client';

import { useEffect, useState } from 'react';
import {
	AreaChart,
	Area,
	XAxis,
	YAxis,
	Tooltip,
	ResponsiveContainer,
	CartesianGrid,
} from 'recharts';

interface Point {
	date: string;
	consumed: number;
	reserved: number;
}

export function UsageChart({ userId, allowance }: { userId: string; allowance: number | null }) {
	const [data, setData] = useState<Point[]>([]);

	useEffect(() => {
		void (async () => {
			const { createClient } = await import('@/lib/supabase/client');
			const supabase = createClient();
			const since = new Date(Date.now() - 13 * 86_400_000).toISOString().slice(0, 10);
			const { data: rows } = await supabase
				.from('daily_usage')
				.select('utc_date,reserved_weighted,consumed_weighted')
				.eq('user_id', userId)
				.gte('utc_date', since)
				.order('utc_date');

			// fill missing days with zeros
			const byDate = new Map((rows ?? []).map((r) => [r.utc_date, r]));
			const points: Point[] = [];
			for (let i = 13; i >= 0; i--) {
				const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
				const r = byDate.get(d);
				points.push({
					date: d.slice(5),
					consumed: Number(r?.consumed_weighted ?? 0),
					reserved: Number(r?.reserved_weighted ?? 0),
				});
			}
			setData(points);
		})();
	}, [userId]);

	return (
		<div className="rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-5">
			<div className="mb-3 flex items-center justify-between">
				<h3 className="text-sm font-medium">Last 14 days</h3>
				{allowance != null && (
					<span className="text-xs text-[var(--nx-muted)] tabular-nums">
						daily limit {allowance.toLocaleString()}
					</span>
				)}
			</div>
			<div className="h-48">
				<ResponsiveContainer width="100%" height="100%">
					<AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
						<defs>
							<linearGradient id="gConsumed" x1="0" y1="0" x2="0" y2="1">
								<stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
								<stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
							</linearGradient>
						</defs>
						<CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
						<XAxis dataKey="date" tick={{ fill: '#a1a1aa', fontSize: 11 }} axisLine={false} tickLine={false} />
						<YAxis tick={{ fill: '#a1a1aa', fontSize: 11 }} axisLine={false} tickLine={false} width={56} />
						<Tooltip
							contentStyle={{
								background: '#111113',
								border: '1px solid #27272a',
								borderRadius: 8,
								fontSize: 12,
							}}
							formatter={(v) => Number(v).toLocaleString()}
						/>
						<Area
							type="monotone"
							dataKey="consumed"
							stroke="#818cf8"
							strokeWidth={2}
							fill="url(#gConsumed)"
						/>
					</AreaChart>
				</ResponsiveContainer>
			</div>
		</div>
	);
}
