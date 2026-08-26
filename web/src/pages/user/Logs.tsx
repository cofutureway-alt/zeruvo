import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { DashboardShell } from '../../components/DashboardShell';

interface LogRow {
	id: number;
	upstream_model: string;
	tokens_in: number;
	tokens_out: number;
	weighted_tokens: number;
	latency_ms: number;
	status: number;
	created_at: string;
}

export default function Logs() {
	const [email, setEmail] = useState('');
	const [logs, setLogs] = useState<LogRow[]>([]);

	useEffect(() => {
		void (async () => {
			const { data: { user } } = await supabase.auth.getUser();
			if (!user) return;
			setEmail(user.email ?? '');
			const { data } = await supabase
				.from('request_logs')
				.select('*')
				.order('created_at', { ascending: false })
				.limit(100);
			setLogs((data ?? []) as LogRow[]);
		})();
	}, []);

	return (
		<DashboardShell variant="user" email={email}>
			<div className="space-y-6">
				<header>
					<h1 className="text-xl font-semibold tracking-tight">Logs</h1>
					<p className="mt-0.5 text-sm text-[var(--nx-muted)]">Last 100 gateway requests.</p>
				</header>

				<div className="overflow-x-auto rounded-xl border border-[var(--nx-border)]">
					<table className="w-full min-w-[640px] text-sm">
						<thead className="bg-zinc-900/60 text-xs uppercase tracking-wide text-[var(--nx-muted)]">
							<tr>
								<th className="px-4 py-3 text-start">Time</th>
								<th className="px-4 py-3 text-start">Model</th>
								<th className="px-4 py-3 text-end">In</th>
								<th className="px-4 py-3 text-end">Out</th>
								<th className="px-4 py-3 text-end">Weighted</th>
								<th className="px-4 py-3 text-end">Latency</th>
								<th className="px-4 py-3 text-end">Status</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-[var(--nx-border)]">
							{logs.map((l) => (
								<tr key={l.id}>
									<td className="whitespace-nowrap px-4 py-2.5 text-xs text-[var(--nx-muted)]">
										{new Date(l.created_at).toLocaleString()}
									</td>
									<td className="px-4 py-2.5 font-mono text-xs">{l.upstream_model}</td>
									<td className="px-4 py-2.5 text-end tabular-nums">{l.tokens_in.toLocaleString()}</td>
									<td className="px-4 py-2.5 text-end tabular-nums">{l.tokens_out.toLocaleString()}</td>
									<td className="px-4 py-2.5 text-end font-medium tabular-nums">{l.weighted_tokens.toLocaleString()}</td>
									<td className="px-4 py-2.5 text-end tabular-nums text-xs text-[var(--nx-muted)]">
										{(l.latency_ms / 1000).toFixed(1)}s
									</td>
									<td className="px-4 py-2.5 text-end">
										<span className={`rounded-full px-2 py-0.5 text-[11px] tabular-nums ${l.status < 400 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
											{l.status}
										</span>
									</td>
								</tr>
							))}
							{logs.length === 0 && (
								<tr>
									<td colSpan={7} className="px-4 py-12 text-center text-sm text-[var(--nx-muted)]">No requests yet.</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			</div>
		</DashboardShell>
	);
}
