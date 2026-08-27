import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { DashboardShell } from '../../components/DashboardShell';

interface CouponRow {
	code: string;
	percent_off: number | string;
	valid_from: string;
	valid_to: string;
	max_redemptions: number;
	times_redeemed: number;
	active: boolean;
}

export default function Coupons() {
	const [email, setEmail] = useState('');
	const [rows, setRows] = useState<CouponRow[]>([]);
	const [code, setCode] = useState('');
	const [percent, setPercent] = useState('10');
	const [days, setDays] = useState('30');
	const [maxRedemptions, setMaxRedemptions] = useState('100');

	const load = useCallback(async () => {
		const { data: { user } } = await supabase.auth.getUser();
		setEmail(user?.email ?? '');
		const { data } = await supabase.from('coupons').select('*').order('valid_from', { ascending: false });
		setRows((data ?? []) as CouponRow[]);
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	async function create() {
		if (!code.trim()) return;
		await supabase.from('coupons').insert({
			code: code.trim().toUpperCase(),
			percent_off: Number(percent),
			valid_from: new Date().toISOString(),
			valid_to: new Date(Date.now() + Number(days) * 86_400_000).toISOString(),
			max_redemptions: Number(maxRedemptions),
			active: true,
		});
		setCode('');
		await load();
	}

	async function remove(codeId: string) {
		await supabase.from('coupons').delete().eq('code', codeId);
		await load();
	}

	return (
		<DashboardShell variant="admin" email={email}>
			<div className="space-y-6">
				<header>
					<h1 className="text-xl font-semibold tracking-tight">Coupons</h1>
					<p className="mt-0.5 text-sm text-[var(--nx-muted)]">Discount codes applied at checkout.</p>
				</header>

				<div className="flex flex-wrap gap-2">
					<input value={code} onChange={(e) => setCode(e.target.value)} placeholder="CODE" className="w-36 rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 font-mono text-sm uppercase outline-none focus:border-cyan-500" />
					<input type="number" min={1} max={100} value={percent} onChange={(e) => setPercent(e.target.value)} placeholder="% off" className="w-24 rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm tabular-nums outline-none focus:border-cyan-500" />
					<input type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} placeholder="valid days" className="w-28 rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm tabular-nums outline-none focus:border-cyan-500" />
					<input type="number" min={1} value={maxRedemptions} onChange={(e) => setMaxRedemptions(e.target.value)} placeholder="max uses" className="w-28 rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm tabular-nums outline-none focus:border-cyan-500" />
					<button onClick={create} disabled={!code.trim()} className="flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-40">
						<Plus size={15} />
						Create
					</button>
				</div>

				<div className="overflow-hidden rounded-xl border border-[var(--nx-border)]">
					<table className="w-full text-sm">
						<thead className="bg-zinc-900/60 text-xs uppercase tracking-wide text-[var(--nx-muted)]">
							<tr>
								<th className="px-4 py-3 text-start">Code</th>
								<th className="px-4 py-3 text-end">Off</th>
								<th className="px-4 py-3 text-start">Valid until</th>
								<th className="px-4 py-3 text-end">Used</th>
								<th className="px-4 py-3 text-end">Status</th>
								<th className="px-4 py-3" />
							</tr>
						</thead>
						<tbody className="divide-y divide-[var(--nx-border)]">
							{rows.map((c) => (
								<tr key={c.code}>
									<td className="px-4 py-3 font-mono text-xs">{c.code}</td>
									<td className="px-4 py-3 text-end tabular-nums">{Number(c.percent_off)}%</td>
									<td className="px-4 py-3 text-xs text-[var(--nx-muted)]">{c.valid_to?.slice(0, 10)}</td>
									<td className="px-4 py-3 text-end tabular-nums">{c.times_redeemed}/{c.max_redemptions}</td>
									<td className="px-4 py-3 text-end">
										<span className={`rounded-full px-2 py-0.5 text-[11px] ${c.active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-700/40 text-zinc-400'}`}>
											{c.active ? 'active' : 'inactive'}
										</span>
									</td>
									<td className="px-4 py-3 text-end">
										<button onClick={() => remove(c.code)} className="rounded-lg p-2 text-[var(--nx-muted)] hover:bg-red-500/10 hover:text-red-400" aria-label="Delete">
											<Trash2 size={14} />
										</button>
									</td>
								</tr>
							))}
							{rows.length === 0 && (
								<tr>
									<td colSpan={6} className="px-4 py-12 text-center text-sm text-[var(--nx-muted)]">No coupons yet.</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			</div>
		</DashboardShell>
	);
}
