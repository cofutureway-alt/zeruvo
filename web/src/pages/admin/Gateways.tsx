import { useCallback, useEffect, useState } from 'react';
import { Wallet, Check, AlertTriangle, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { DashboardShell } from '../../components/DashboardShell';
import { edgeCall } from '../../lib/admin-api';

interface GatewayRow {
	id: string;
	enabled: boolean;
	mode: 'test' | 'live';
	merchant_id: string | null;
	api_key_last4: string | null;
	encrypted_api_key: boolean;
	egp_rate: number;
}

/** Admin payment-gateway settings (SPA port) — secrets encrypted via edge. */
export default function Gateways() {
	const [email, setEmail] = useState('');
	const [row, setRow] = useState<GatewayRow | null>(null);
	const [merchantId, setMerchantId] = useState('');
	const [apiKey, setApiKey] = useState('');
	const [secretKey, setSecretKey] = useState('');
	const [mode, setMode] = useState<'test' | 'live'>('test');
	const [enabled, setEnabled] = useState(false);
	const [egpRate, setEgpRate] = useState(50);
	const [saving, setSaving] = useState(false);
	const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

	const load = useCallback(async () => {
		const { data: { user } } = await supabase.auth.getUser();
		setEmail(user?.email ?? '');
		const { data } = await supabase.from('payment_gateways').select('*').eq('gateway', 'kashier').maybeSingle();
		if (data) {
			setRow(data as GatewayRow);
			setMerchantId((data as GatewayRow).merchant_id ?? '');
			setMode((data as GatewayRow).mode);
			setEnabled((data as GatewayRow).enabled);
			setEgpRate((data as GatewayRow).egp_rate ?? 50);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	async function save() {
		if (!merchantId.trim()) return setMessage({ ok: false, text: 'Merchant ID is required.' });
		if (!apiKey.trim() && !row) return setMessage({ ok: false, text: 'API key required on first setup.' });
		if (!secretKey.trim() && !row) return setMessage({ ok: false, text: 'Secret key required on first setup.' });

		setSaving(true);
		setMessage(null);

		// encrypt any newly entered secrets via the admin-crypto edge function
		const values = [apiKey.trim(), secretKey.trim()].filter(Boolean);
		let encApiKey: string | undefined;
		let encSecretKey: string | undefined;
		if (values.length) {
			const res = await edgeCall<{ encrypted?: string[] }>('admin-crypto', { values });
			const encrypted = res?.encrypted ?? [];
			if (!encrypted.length) {
				setMessage({ ok: false, text: 'Encryption service failed.' });
				setSaving(false);
				return;
			}
			// map encrypted values back to the correct fields
			let idx = 0;
			if (apiKey.trim()) encApiKey = encrypted[idx++];
			if (secretKey.trim()) encSecretKey = encrypted[idx++];
		}

		const payload: Record<string, unknown> = {
			gateway: 'kashier',
			enabled,
			mode,
			merchant_id: merchantId.trim(),
			egp_rate: Number(egpRate) || 50,
		};
		if (encApiKey) payload.encrypted_api_key = encApiKey;
		if (encSecretKey) payload.encrypted_secret_key = encSecretKey;

		const { error } = await supabase
			.from('payment_gateways')
			.upsert(payload, { onConflict: 'gateway' });

		if (error) setMessage({ ok: false, text: error.message });
		else {
			setMessage({ ok: true, text: `Kashier ${enabled ? 'enabled' : 'saved'} (${mode} mode). Credentials are encrypted at rest.` });
			setApiKey('');
			setSecretKey('');
			await load();
		}
		setSaving(false);
	}

	return (
		<DashboardShell variant="admin" email={email}>
			<div className="mx-auto max-w-3xl space-y-6">
				<header>
					<h1 className="text-xl font-semibold tracking-tight">Payment Gateways</h1>
					<p className="mt-0.5 text-sm text-[var(--nx-muted)]">Connect your Kashier account to accept plan payments in-place.</p>
				</header>

				<section className="rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-6">
					<div className="flex items-center gap-3">
						<div className="grid size-10 place-items-center rounded-xl bg-cyan-500/10">
							<Wallet size={20} className="text-cyan-400" />
						</div>
						<div className="flex-1">
							<p className="font-medium">Kashier</p>
							<p className="text-xs text-[var(--nx-muted)]">Cards · Mobile wallets · Fawry · BNPL — checkout embedded in your site</p>
						</div>
						<span className={`rounded-full px-2.5 py-0.5 text-[11px] ${row?.api_key_last4 || apiKey ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-700/40 text-zinc-400'}`}>
							{row?.api_key_last4 || apiKey ? `Connected${row?.api_key_last4 ? ' ••••' + row.api_key_last4 : ''}` : 'Not connected'}
						</span>
					</div>

					<div className="mt-5 space-y-4">
						<label className="block">
							<span className="text-sm text-[var(--nx-muted)]">Merchant ID (MID)</span>
							<input value={merchantId} onChange={(e) => setMerchantId(e.target.value)} placeholder="MID-12345-6789" className="mt-1 w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-cyan-500" />
						</label>
						<div className="grid gap-4 sm:grid-cols-2">
							<label className="block">
								<span className="text-sm text-[var(--nx-muted)]">API Key {row?.api_key_last4 && <span className="text-emerald-400">(••••{row.api_key_last4})</span>}</span>
								<input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={row ? 'Leave blank to keep current' : 'From Dashboard → Integrations'} className="mt-1 w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-cyan-500 placeholder:text-xs" />
							</label>
							<label className="block">
								<span className="text-sm text-[var(--nx-muted)]">Secret Key</span>
								<input type="password" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} placeholder={row ? 'Leave blank to keep current' : 'From Dashboard → Integrations'} className="mt-1 w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-cyan-500 placeholder:text-xs" />
							</label>
						</div>

						<div className="flex flex-wrap items-center gap-6">
							<div className="flex overflow-hidden rounded-lg border border-[var(--nx-border)]">
								<button onClick={() => setMode('test')} className={`px-4 py-1.5 text-sm ${mode === 'test' ? 'bg-amber-500/15 font-medium text-amber-400' : 'text-[var(--nx-muted)]'}`}>Test</button>
								<button onClick={() => setMode('live')} className={`px-4 py-1.5 text-sm ${mode === 'live' ? 'bg-emerald-500/15 font-medium text-emerald-400' : 'text-[var(--nx-muted)]'}`}>Live</button>
							</div>
							<label className="flex cursor-pointer items-center gap-2 text-sm">
								<input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
								Enable gateway
							</label>
						</div>

						<label className="block">
							<span className="text-sm text-[var(--nx-muted)]">USD → EGP exchange rate</span>
							<p className="mb-1 text-xs text-[var(--nx-muted)]">Prices in USD are converted to EGP at this rate before sending to Kashier.</p>
							<input
								type="number"
								min={1}
								step={0.5}
								value={egpRate}
								onChange={(e) => setEgpRate(Number(e.target.value) || 50)}
								className="mt-1 w-32 rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-cyan-500"
							/>
						</label>

						{mode === 'live' && (
							<p className="flex items-center gap-2 rounded-lg bg-amber-500/10 px-4 py-2.5 text-xs text-amber-400">
								<AlertTriangle size={14} />
								Live mode charges real cards. Make sure your Kashier account is approved for live.
							</p>
						)}

						{message && (
							<p className={`flex items-center gap-2 text-sm ${message.ok ? 'text-emerald-400' : 'text-red-400'}`}>
								{message.ok ? <Check size={15} /> : <AlertTriangle size={15} />}
								{message.text}
							</p>
						)}

						<button onClick={save} disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-40">
							{saving && <Loader2 size={14} className="animate-spin" />}
							Save configuration
						</button>
					</div>
				</section>

				<p className="text-xs leading-relaxed text-[var(--nx-muted)]">
					Keys are AES-256-GCM encrypted server-side before storage and never leave the server except inside signed checkout requests. Webhooks are verified with HMAC-SHA256 per Kashier's official signature scheme.
				</p>
			</div>
		</DashboardShell>
	);
}
