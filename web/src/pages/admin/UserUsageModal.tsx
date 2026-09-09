import { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { UserRow } from './Users';

interface LogRow {
	id: string;
	upstream_model: string | null;
	tokens_in: number | null;
	tokens_out: number | null;
	weighted_tokens: number | null;
	latency_ms: number | null;
	status: number | null;
	error_code: string | null;
	created_at: string;
}

interface ModelAgg {
	model_id: string;
	display_name: string;
	upstream_model_id: string;
	requests: number;
	tokens_in: number;
	tokens_out: number;
	weighted_tokens: number;
}

/** Per-user usage stats popup for the admin Users page. */
export function UserUsageModal({ user, onClose }: { user: UserRow; onClose: () => void }) {
	const [loading, setLoading] = useState(true);
	const [totals, setTotals] = useState({ requests: 0, tokens_in: 0, tokens_out: 0 });
	const [today, setToday] = useState({ consumed: 0, reserved: 0, allowance: 0 });
	const [modelRows, setModelRows] = useState<ModelAgg[]>([]);
	const [logs, setLogs] = useState<LogRow[]>([]);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			setLoading(true);

			// plan allowance (for the remaining-quota card)
			let allowance = 0;
			if (user.sub?.plan_id) {
				const { data: plan } = await supabase
					.from('plans')
					.select('daily_weighted_tokens')
					.eq('id', user.sub.plan_id)
					.maybeSingle();
				allowance = Number(plan?.daily_weighted_tokens ?? 0);
			}

			const todayStr = new Date().toISOString().slice(0, 10);
			const [{ data: du }, { data: logsRows }, modelRowsResult] = await Promise.all([
				supabase
					.from('daily_usage')
					.select('consumed_weighted, reserved_weighted')
					.eq('user_id', user.id)
					.eq('utc_date', todayStr)
					.maybeSingle(),
				// last 10 request logs
				supabase
					.from('request_logs')
					.select('id, upstream_model, tokens_in, tokens_out, weighted_tokens, latency_ms, status, error_code, created_at')
					.eq('user_id', user.id)
					.order('created_at', { ascending: false })
					.limit(10),
				// lifetime per-model totals (fresh logs + archived aggregates)
				(async () => {
					const map = new Map<string, { requests: number; tokens_in: number; tokens_out: number; weighted_tokens: number }>();
					const add = (mid: string | null, r: { requests: number; tokens_in: number; tokens_out: number; weighted_tokens: number }) => {
						const key = mid ?? 'unknown';
						const agg = map.get(key) ?? { requests: 0, tokens_in: 0, tokens_out: 0, weighted_tokens: 0 };
						agg.requests += r.requests;
						agg.tokens_in += r.tokens_in;
						agg.tokens_out += r.tokens_out;
						agg.weighted_tokens += r.weighted_tokens;
						map.set(key, agg);
					};

					const { data: fresh } = await supabase
						.from('request_logs')
						.select('model_id, tokens_in, tokens_out, weighted_tokens')
						.eq('user_id', user.id);
					for (const r of fresh ?? []) {
						add(r.model_id, {
							requests: 1,
							tokens_in: Number(r.tokens_in ?? 0),
							tokens_out: Number(r.tokens_out ?? 0),
							weighted_tokens: Number(r.weighted_tokens ?? 0),
						});
					}

					const { data: archived } = await supabase
						.from('usage_daily_agg')
						.select('model_id, requests, tokens_in, tokens_out, weighted_tokens')
						.eq('user_id', user.id);
					for (const r of archived ?? []) {
						add(r.model_id, {
							requests: Number(r.requests ?? 0),
							tokens_in: Number(r.tokens_in ?? 0),
							tokens_out: Number(r.tokens_out ?? 0),
							weighted_tokens: Number(r.weighted_tokens ?? 0),
						});
					}

					// resolve model names
					const ids = [...map.keys()].filter((k) => k !== 'unknown');
					const names = new Map<string, { display_name: string; upstream_model_id: string }>();
					if (ids.length) {
						const { data: models } = await supabase
							.from('models')
							.select('id, display_name, upstream_model_id')
							.in('id', ids);
						for (const m of models ?? []) names.set(m.id, m);
					}

					return [...map.entries()].map(([mid, agg]) => ({
						model_id: mid,
						display_name: names.get(mid)?.display_name ?? 'Unknown / deleted',
						upstream_model_id: names.get(mid)?.upstream_model_id ?? '—',
						...agg,
					})).sort((a, b) => b.weighted_tokens - a.weighted_tokens);
				})(),
			]);

			if (cancelled) return;
			setTotals({
				requests: modelRowsResult.reduce((s, r) => s + r.requests, 0),
				tokens_in: modelRowsResult.reduce((s, r) => s + r.tokens_in, 0),
				tokens_out: modelRowsResult.reduce((s, r) => s + r.tokens_out, 0),
			});
			setToday({ consumed: Number(du?.consumed_weighted ?? 0), reserved: Number(du?.reserved_weighted ?? 0), allowance });
			setModelRows(modelRowsResult);
			setLogs((logsRows ?? []) as never);
			setLoading(false);
		})();
		return () => { cancelled = true; };
	}, [user.id, user.sub?.plan_id]);

	const pct = today.allowance > 0 ? Math.min((today.consumed / today.allowance) * 100, 100) : 0;

	return (
		<div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm">
			<div className="w-full max-w-3xl rounded-2xl border border-[var(--nx-border)] bg-[var(--nx-surface)] shadow-2xl">
				<header className="flex items-center justify-between border-b border-[var(--nx-border)] px-6 py-4">
					<div className="min-w-0">
						<h2 className="truncate font-display font-semibold">{user.email} — usage</h2>
						<p className="text-[11px] text-[var(--nx-muted)]">
							{user.sub ? `${user.sub.plan_name} · expires ${user.sub.expires_at.slice(0, 10)}` : 'no active plan'}
						</p>
					</div>
					<button onClick={onClose} className="rounded-lg p-1.5 text-[var(--nx-muted)] hover:bg-zinc-800/60"><X size={18} /></button>
				</header>

				{loading ? (
					<div className="grid h-64 place-items-center">
						<Loader2 size={22} className="animate-spin text-[var(--nx-muted)]" />
					</div>
				) : (
					<div className="max-h-[75vh] space-y-5 overflow-y-auto p-6">
						{/* today vs allowance */}
						<section className="rounded-xl border border-[var(--nx-border)] p-4">
							<div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
								<span className="font-medium">Today's quota</span>
								<span className="tabular-nums text-[var(--nx-muted)]">
									{today.consumed.toLocaleString()} / {today.allowance.toLocaleString()} weighted
									{today.reserved > 0 && ` (+${today.reserved.toLocaleString()} in-flight)`}
								</span>
							</div>
							<div className="h-2.5 overflow-hidden rounded-full bg-zinc-800">
								<div
									className={`h-full rounded-full transition-all ${pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-cyan-500'}`}
									style={{ width: `${pct}%` }}
								/>
							</div>
						</section>

						{/* lifetime totals */}
						<section className="grid gap-3 sm:grid-cols-4">
							<Stat title="Total requests" value={totals.requests.toLocaleString()} />
							<Stat title="Tokens in" value={totals.tokens_in.toLocaleString()} />
							<Stat title="Tokens out" value={totals.tokens_out.toLocaleString()} />
							<Stat title="Total tokens" value={(totals.tokens_in + totals.tokens_out).toLocaleString()} highlight />
						</section>

						{/* per-model breakdown */}
						<section className="overflow-hidden rounded-xl border border-[var(--nx-border)]">
							<h3 className="border-b border-[var(--nx-border)] bg-zinc-900/60 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--nx-muted)]">
								By model (lifetime)
							</h3>
							<div className="overflow-x-auto">
								<table className="w-full min-w-[480px] text-sm">
									<thead className="text-[11px] uppercase tracking-wide text-[var(--nx-muted)]">
										<tr>
											<th className="px-4 py-2 text-start">Model</th>
											<th className="px-4 py-2 text-end">Requests</th>
											<th className="px-4 py-2 text-end">Tokens In</th>
											<th className="px-4 py-2 text-end">Tokens Out</th>
											<th className="px-4 py-2 text-end">Weighted</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-[var(--nx-border)]">
										{modelRows.map((r) => (
											<tr key={r.model_id}>
												<td className="px-4 py-2">
													<p className="font-medium">{r.display_name}</p>
													<p className="font-mono text-[10px] text-[var(--nx-muted)]">{r.upstream_model_id}</p>
												</td>
												<td className="px-4 py-2 text-end tabular-nums">{r.requests.toLocaleString()}</td>
												<td className="px-4 py-2 text-end tabular-nums">{r.tokens_in.toLocaleString()}</td>
												<td className="px-4 py-2 text-end tabular-nums">{r.tokens_out.toLocaleString()}</td>
												<td className="px-4 py-2 text-end font-medium tabular-nums">{r.weighted_tokens.toLocaleString()}</td>
											</tr>
										))}
										{modelRows.length === 0 && (
											<tr>
												<td colSpan={5} className="px-4 py-8 text-center text-sm text-[var(--nx-muted)]">
													No usage yet.
												</td>
											</tr>
										)}
									</tbody>
								</table>
							</div>
						</section>

						{/* last 10 logs */}
						<section className="overflow-hidden rounded-xl border border-[var(--nx-border)]">
							<h3 className="border-b border-[var(--nx-border)] bg-zinc-900/60 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--nx-muted)]">
								Last 10 requests
							</h3>
							<div className="overflow-x-auto">
								<table className="w-full min-w-[560px] text-sm">
									<thead className="text-[11px] uppercase tracking-wide text-[var(--nx-muted)]">
										<tr>
											<th className="px-4 py-2 text-start">Time</th>
											<th className="px-4 py-2 text-start">Model</th>
											<th className="px-4 py-2 text-end">In / Out</th>
											<th className="px-4 py-2 text-end">Weighted</th>
											<th className="px-4 py-2 text-end">Latency</th>
											<th className="px-4 py-2 text-end">Status</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-[var(--nx-border)]">
										{logs.map((l) => (
											<tr key={l.id}>
												<td className="px-4 py-2 font-mono text-[11px] text-[var(--nx-muted)]">
													{new Date(l.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
												</td>
												<td className="px-4 py-2 font-mono text-xs">{l.upstream_model ?? '—'}</td>
												<td className="px-4 py-2 text-end tabular-nums">
													{(l.tokens_in ?? 0).toLocaleString()} / {(l.tokens_out ?? 0).toLocaleString()}
												</td>
												<td className="px-4 py-2 text-end tabular-nums">{(l.weighted_tokens ?? 0).toLocaleString()}</td>
												<td className="px-4 py-2 text-end tabular-nums text-[var(--nx-muted)]">
													{l.latency_ms != null ? `${(l.latency_ms / 1000).toFixed(1)}s` : '—'}
												</td>
												<td className="px-4 py-2 text-end">
													{l.error_code ? (
														<span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] text-red-400">{l.error_code}</span>
													) : (
														<span className={`rounded-full px-2 py-0.5 text-[10px] ${(l.status ?? 0) < 300 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>
															{l.status ?? '—'}
														</span>
													)}
												</td>
											</tr>
										))}
										{logs.length === 0 && (
											<tr>
												<td colSpan={6} className="px-4 py-8 text-center text-sm text-[var(--nx-muted)]">
													No requests yet.
												</td>
											</tr>
										)}
									</tbody>
								</table>
							</div>
						</section>
					</div>
				)}
			</div>
		</div>
	);
}

function Stat({ title, value, highlight }: { title: string; value: string; highlight?: boolean }) {
	return (
		<div className="rounded-xl border border-[var(--nx-border)] p-4">
			<p className="mb-1.5 text-[11px] uppercase tracking-wide text-[var(--nx-muted)]">{title}</p>
			<p className={`text-xl font-semibold tabular-nums ${highlight ? 'text-cyan-300' : ''}`}>{value}</p>
		</div>
	);
}
