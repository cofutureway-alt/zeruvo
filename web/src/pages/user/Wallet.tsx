import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Wallet as WalletIcon, Plus, Repeat, ArrowUpRight, ArrowDownLeft, ShieldCheck } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { DashboardShell } from '../../components/DashboardShell';
import { useAppSettings } from '../../hooks/useAppSettings';
import { PageHeader, KpiCard, Pill, EmptyState, Toggle } from '../../components/console-kit';

interface WalletRow {
	balance_usd: number | string;
	reserved_usd: number | string;
}
interface TxRow {
	id: number;
	kind: string;
	amount_usd: number | string;
	balance_after: number | string;
	note: string | null;
	created_at: string;
}

const TX_KINDS: Record<string, { label: string; tone: 'green' | 'red' | 'amber' | 'violet' | 'teal' }> = {
	topup: { label: 'Top-up', tone: 'green' },
	usage: { label: 'Usage', tone: 'red' },
	refund: { label: 'Refund', tone: 'amber' },
	admin_grant: { label: 'Admin grant', tone: 'violet' },
	admin_deduct: { label: 'Admin deduct', tone: 'red' },
};

export default function Wallet() {
	const [email, setEmail] = useState('');
	const [wallet, setWallet] = useState<WalletRow | null>(null);
	const [txs, setTxs] = useState<TxRow[]>([]);
	const settings = useAppSettings();
	const [searchParams, setSearchParams] = useSearchParams();

	const [amount, setAmount] = useState<number | null>(null);
	const [custom, setCustom] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [iframeUrl, setIframeUrl] = useState<string | null>(null);
	const [pref, setPref] = useState<'plan_first' | 'wallet_first'>('plan_first');
	const [savingPref, setSavingPref] = useState(false);

	const min = settings?.wallet_min_topup_usd ?? 10;
	const max = settings?.wallet_max_topup_usd ?? 200;
	const quick = settings?.wallet_quick_amounts ?? [10, 25, 50, 100, 200];

	const load = useCallback(async () => {
		const { data: { user } } = await supabase.auth.getUser();
		if (!user) return;
		setEmail(user.email ?? '');
		const [w, t, p] = await Promise.all([
			supabase.from('wallets').select('balance_usd,reserved_usd').eq('user_id', user.id).maybeSingle(),
			supabase.from('wallet_transactions').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(50),
			supabase.from('profiles').select('billing_preference').eq('id', user.id).maybeSingle(),
		]);
		setWallet((w.data as WalletRow | null) ?? { balance_usd: 0, reserved_usd: 0 });
		setTxs((t.data ?? []) as TxRow[]);
		setPref(((p.data?.billing_preference as 'plan_first' | 'wallet_first') ?? 'plan_first'));
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	// ?paid=1 — Kashier redirects here after a completed top-up
	useEffect(() => {
		if (searchParams.get('paid') === '1') {
			setSearchParams({}, { replace: true });
			// webhook may lag the redirect by a second — refetch twice
			void load();
			const t = setTimeout(() => void load(), 2500);
			return () => clearTimeout(t);
		}
	}, [searchParams, setSearchParams, load]);

	async function switchPref(next: 'plan_first' | 'wallet_first') {
		setSavingPref(true);
		setPref(next);
		const { data: { user } } = await supabase.auth.getUser();
		if (user) await supabase.from('profiles').update({ billing_preference: next }).eq('id', user.id);
		setSavingPref(false);
	}

	async function topup() {
		const value = amount ?? (custom.trim() === '' ? null : Number(custom));
		if (value == null || !Number.isFinite(value) || value < min || value > max) {
			setError(`Enter an amount between $${min} and $${max}.`);
			return;
		}
		setBusy(true);
		setError(null);
		const { data: { session } } = await supabase.auth.getSession();
		const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/checkout`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${session?.access_token ?? ''}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ type: 'topup', amount_usd: value }),
		});
		const json = await res.json().catch(() => ({}));
		if (!res.ok) {
			setError(json.error ?? 'Failed to start checkout');
		} else {
			setIframeUrl(json.checkout_url);
		}
		setBusy(false);
	}

	const balance = Number(wallet?.balance_usd ?? 0);
	const reserved = Number(wallet?.reserved_usd ?? 0);

	return (
		<DashboardShell variant="user" email={email}>
			<div className="space-y-6">
				<PageHeader
					title="Wallet"
					subtitle="Pay-As-You-Go credit — every request bills per-token from this balance."
					actions={
						<div className="rounded-xl border border-border bg-[var(--nx-surface)] px-4 py-2.5">
							<Toggle
								checked={pref === 'wallet_first'}
								onChange={(v) => switchPref(v ? 'wallet_first' : 'plan_first')}
								disabled={savingPref}
								labels={['Plan quota', 'Pay-As-You-Go']}
							/>
						</div>
					}
				/>

				<div className="grid gap-4 sm:grid-cols-3">
					<KpiCard
						label="Available balance"
						value={`$${balance.toFixed(4)}`}
						sub={reserved > 0 ? `$${reserved.toFixed(4)} held for in-flight requests` : 'No active holds'}
						icon={<WalletIcon size={15} />}
					/>
					<KpiCard
						label="Top-up bounds"
						value={`$${min} – $${max}`}
						sub="per transaction"
						icon={<Plus size={15} />}
						tone="gray"
					/>
					<KpiCard
						label="Billing preference"
						value={pref === 'wallet_first' ? 'PAYG' : 'Plan'}
						sub={pref === 'wallet_first' ? 'wallet is charged first' : 'plan quota is consumed first'}
						icon={<Repeat size={15} />}
						tone="violet"
					/>
				</div>

				{/* top-up */}
				<section className="rounded-xl border border-border bg-[var(--nx-surface)] p-5">
					<h2 className="text-sm font-semibold">Top up</h2>
					<div className="mt-3 flex flex-wrap gap-2">
						{quick.map((v) => (
							<button
								key={v}
								onClick={() => { setAmount(v); setCustom(''); setError(null); }}
								className={`rounded-xl border px-5 py-2.5 font-data text-sm font-medium tabular-nums transition-colors ${
									amount === v
										? 'border-cyan-500/60 bg-cyan-500/10 text-cyan-300'
										: 'border-border text-foreground hover:border-cyan-500/40'
								}`}
							>
								${v}
							</button>
						))}
						<input
							value={custom}
							onChange={(e) => { setCustom(e.target.value); setAmount(null); setError(null); }}
							placeholder="Custom"
							inputMode="decimal"
							dir="ltr"
							className={`w-28 rounded-xl border bg-transparent px-3 py-2.5 font-data text-sm tabular-nums outline-none focus:border-cyan-500 ${
								amount == null && custom.trim() !== '' ? 'border-cyan-500/60' : 'border-border'
							}`}
						/>
						<button
							onClick={topup}
							disabled={busy}
							className="flex items-center gap-2 rounded-xl bg-cyan-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-40"
						>
							<Plus size={15} /> {busy ? 'Starting…' : 'Top up'}
						</button>
					</div>
					{error && <p className="mt-2 text-sm text-red-400">{error}</p>}
					<p className="mt-3 text-xs text-[var(--nx-muted)]">
						Secure checkout via Kashier. Credit lands in your wallet the moment payment is confirmed.
					</p>
				</section>

				{/* ledger */}
				<section>
					<h2 className="mb-3 font-data text-xs font-semibold uppercase tracking-[0.18em] text-[var(--nx-muted)]">
						Transactions
					</h2>
					{txs.length === 0 ? (
						<EmptyState icon={<WalletIcon size={26} />} title="No wallet activity yet" hint="Top up to start paying per-token for any PAYG-enabled model." />
					) : (
						<div className="overflow-x-auto rounded-xl border border-[var(--nx-border)]">
							<table className="w-full min-w-[560px] text-sm">
								<thead className="bg-zinc-900/60 font-data text-[11px] uppercase tracking-wider text-[var(--nx-muted)]">
									<tr>
										<th className="px-4 py-3 text-start">Kind</th>
										<th className="px-4 py-3 text-start">Amount</th>
										<th className="px-4 py-3 text-start">Balance after</th>
										<th className="px-4 py-3 text-start">Note</th>
										<th className="px-4 py-3 text-start">Date</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-[var(--nx-border)]">
									{txs.map((tx) => {
										const amt = Number(tx.amount_usd);
										const kind = TX_KINDS[tx.kind] ?? { label: tx.kind, tone: 'gray' as const };
										return (
											<tr key={tx.id} className="transition-colors hover:bg-cyan-500/[0.03]">
												<td className="px-4 py-3"><Pill tone={kind.tone}>{kind.label}</Pill></td>
												<td className={`px-4 py-3 font-data text-xs tabular-nums ${amt >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
													{amt >= 0 ? <ArrowUpRight size={12} className="inline" /> : <ArrowDownLeft size={12} className="inline" />}
													{' '}{amt >= 0 ? '+' : ''}${amt.toFixed(4)}
												</td>
												<td className="px-4 py-3 font-data text-xs tabular-nums">${Number(tx.balance_after).toFixed(4)}</td>
												<td className="max-w-48 truncate px-4 py-3 text-xs text-[var(--nx-muted)]">{tx.note ?? '—'}</td>
												<td className="px-4 py-3 text-xs text-[var(--nx-muted)]">{new Date(tx.created_at).toLocaleString()}</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					)}
				</section>
			</div>

			{/* Kashier secure checkout */}
			{iframeUrl && (
				<div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm">
					<div className="flex h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[var(--nx-border)] bg-[var(--nx-surface)]">
						<header className="flex items-center justify-between border-b border-[var(--nx-border)] px-5 py-3">
							<p className="flex items-center gap-2 text-sm font-semibold">
								<ShieldCheck size={15} className="text-emerald-400" /> Secure checkout
							</p>
							<button onClick={() => { setIframeUrl(null); void load(); }} className="rounded-lg px-3 py-1 text-sm text-[var(--nx-muted)] hover:bg-zinc-800/60">
								Close
							</button>
						</header>
						<iframe src={iframeUrl} title="Kashier secure checkout" className="min-h-0 w-full flex-1 border-0" allow="payment" />
					</div>
				</div>
			)}
		</DashboardShell>
	);
}
