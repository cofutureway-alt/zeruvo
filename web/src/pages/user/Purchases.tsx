import { useEffect, useState } from 'react';
import { ReceiptText } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { DashboardShell } from '../../components/DashboardShell';
import { SkeletonTable } from '../../components/skeleton';

interface PurchaseRow {
	id: string;
	invoice_no: string;
	amount_egp: number | string;
	amount_usd_display: number | string;
	method: string;
	status: string;
	created_at: string;
}

export default function Purchases() {
	const [email, setEmail] = useState('');
	const [rows, setRows] = useState<PurchaseRow[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		void (async () => {
			const { data: { user } } = await supabase.auth.getUser();
			if (!user) return;
			setEmail(user.email ?? '');
			const { data } = await supabase
				.from('payments')
				.select('id,invoice_no,amount_egp,amount_usd_display,method,status,created_at')
				.order('created_at', { ascending: false });
			setRows((data ?? []) as PurchaseRow[]);
			setLoading(false);
		})();
	}, []);

	return (
		<DashboardShell variant="user" email={email}>
			<div className="space-y-6">
				<header>
					<h1 className="text-xl font-semibold tracking-tight">Purchases</h1>
					<p className="mt-0.5 text-sm text-[var(--nx-muted)]">All payment history and invoices.</p>
				</header>

				{loading ? <SkeletonTable rows={6} cols={6} /> : (
				<div className="overflow-x-auto rounded-xl border border-[var(--nx-border)]">
					<table className="w-full min-w-[640px] text-sm">
						<thead className="bg-zinc-900/60 text-xs uppercase tracking-wide text-[var(--nx-muted)]">
							<tr>
								<th className="px-4 py-3 text-start">Invoice</th>
								<th className="px-4 py-3 text-start">Date</th>
								<th className="px-4 py-3 text-start">Method</th>
								<th className="px-4 py-3 text-end">USD</th>
								<th className="px-4 py-3 text-end">EGP paid</th>
								<th className="px-4 py-3 text-end">Status</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-[var(--nx-border)]">
							{rows.map((r) => (
								<tr key={r.id}>
									<td className="flex items-center gap-2 px-4 py-3 font-mono text-xs">
										<ReceiptText size={13} className="text-[var(--nx-muted)]" />
										{r.invoice_no}
									</td>
									<td className="px-4 py-3 text-xs text-[var(--nx-muted)]">{r.created_at.slice(0, 10)}</td>
									<td className="px-4 py-3 capitalize">{r.method}</td>
									<td className="px-4 py-3 text-end tabular-nums">${Number(r.amount_usd_display).toFixed(2)}</td>
									<td className="px-4 py-3 text-end tabular-nums">{Number(r.amount_egp).toFixed(2)}</td>
									<td className="px-4 py-3 text-end">
										<span className={`rounded-full px-2 py-0.5 text-[11px] ${r.status === 'paid' ? 'bg-emerald-500/10 text-emerald-400' : r.status === 'pending' ? 'bg-amber-500/10 text-amber-400' : 'bg-red-500/10 text-red-400'}`}>
											{r.status}
										</span>
									</td>
								</tr>
							))}
							{rows.length === 0 && (
								<tr>
									<td colSpan={6} className="px-4 py-12 text-center text-sm text-[var(--nx-muted)]">No purchases yet.</td>
								</tr>
							)}
						</tbody>
					</table>
					</div>
				)}
			</div>
		</DashboardShell>
	);
}
