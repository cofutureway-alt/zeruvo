import type { ModelUsageRow, AggTotals } from '../hooks/useModelUsage';
import { SkeletonTable } from './skeleton';

interface Props {
	data: ModelUsageRow[];
	loading: boolean;
	showProvider?: boolean;
	total: AggTotals;
}

export function ModelUsageTable({ data, loading, showProvider, total }: Props) {
	if (loading) return <SkeletonTable rows={6} cols={showProvider ? 6 : 5} />;

	return (
		<div className="overflow-x-auto rounded-xl border border-[var(--nx-border)]">
			<table className="w-full min-w-[560px] text-sm">
				<thead className="bg-zinc-900/60 text-xs uppercase tracking-wide text-[var(--nx-muted)]">
					<tr>
						<th className="px-4 py-3 text-start">Model</th>
						{showProvider && <th className="px-4 py-3 text-start">Provider</th>}
						<th className="px-4 py-3 text-end">Requests</th>
						<th className="px-4 py-3 text-end">Tokens In</th>
						<th className="px-4 py-3 text-end">Tokens Out</th>
						<th className="px-4 py-3 text-end">Weighted</th>
					</tr>
				</thead>
				<tbody className="divide-y divide-[var(--nx-border)]">
					{data.map((r) => (
						<tr key={r.model_id}>
							<td className="px-4 py-2.5">
								<p className="font-medium">{r.display_name}</p>
								<p className="font-mono text-[11px] text-[var(--nx-muted)]">{r.upstream_model_id}</p>
							</td>
							{showProvider && (
								<td className="px-4 py-2.5 text-xs text-[var(--nx-muted)]">{r.provider_name ?? '—'}</td>
							)}
							<td className="px-4 py-2.5 text-end tabular-nums">{r.requests.toLocaleString()}</td>
							<td className="px-4 py-2.5 text-end tabular-nums">{r.tokens_in.toLocaleString()}</td>
							<td className="px-4 py-2.5 text-end tabular-nums">{r.tokens_out.toLocaleString()}</td>
							<td className="px-4 py-2.5 text-end font-medium tabular-nums">{r.weighted_tokens.toLocaleString()}</td>
						</tr>
					))}
					{data.length === 0 && (
						<tr>
							<td colSpan={showProvider ? 6 : 5} className="px-4 py-12 text-center text-sm text-[var(--nx-muted)]">
								No usage data for this period.
							</td>
						</tr>
					)}
					{data.length > 0 && (
						<tr className="bg-zinc-900/40 font-medium">
							<td className="px-4 py-2.5 text-xs uppercase tracking-wide text-[var(--nx-muted)]">Total</td>
							{showProvider && <td className="px-4 py-2.5" />}
							<td className="px-4 py-2.5 text-end tabular-nums">{total.requests.toLocaleString()}</td>
							<td className="px-4 py-2.5 text-end tabular-nums">{total.tokens_in.toLocaleString()}</td>
							<td className="px-4 py-2.5 text-end tabular-nums">{total.tokens_out.toLocaleString()}</td>
							<td className="px-4 py-2.5 text-end tabular-nums">{total.weighted_tokens.toLocaleString()}</td>
						</tr>
					)}
				</tbody>
			</table>
		</div>
	);
}
