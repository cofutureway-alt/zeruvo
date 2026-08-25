'use client';

import { useEffect, useState } from 'react';
import {
	Wallet,
	Check,
	ExternalLink,
	ShieldCheck,
	AlertTriangle,
	Loader2,
} from 'lucide-react';

interface GatewayConfig {
	enabled: boolean;
	mode: 'test' | 'live';
	merchant_id: string;
	api_key_masked: string;
	secret_key_masked: string;
	allowed_methods: string[];
	default_method: string;
	brand_color: string;
}

const METHODS = [
	{ id: 'card', label: 'Cards (Visa / Mastercard / Meeza)' },
	{ id: 'wallet', label: 'Mobile wallets' },
	{ id: 'fawry', label: 'Fawry' },
	{ id: 'aman', label: 'Aman (bnpl[aman])' },
	{ id: 'valu', label: 'valU (bnpl[valu])' },
] as const;

export function PaymentGatewaysClient() {
	const [cfg, setCfg] = useState<GatewayConfig | null>(null);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

	// editable fields
	const [merchantId, setMerchantId] = useState('');
	const [apiKey, setApiKey] = useState('');
	const [secretKey, setSecretKey] = useState('');
	const [mode, setMode] = useState<'test' | 'live'>('test');
	const [enabled, setEnabled] = useState(false);
	const [methods, setMethods] = useState<Set<string>>(new Set(['card', 'wallet']));
	const [defaultMethod, setDefaultMethod] = useState('card');

	useEffect(() => {
		void (async () => {
			const res = await fetch('/api/admin/payment-gateways');
			if (res.ok) {
				const json = await res.json();
				setCfg(json.gateway);
				if (json.gateway) {
					setMerchantId(json.gateway.merchant_id ?? '');
					setMode(json.gateway.mode);
					setEnabled(json.gateway.enabled);
					setMethods(new Set(json.gateway.allowed_methods ?? ['card']));
					setDefaultMethod(json.gateway.default_method ?? 'card');
				}
			}
			setLoading(false);
		})();
	}, []);

	async function save() {
		if (!merchantId.trim()) {
			setMessage({ ok: false, text: 'Merchant ID is required.' });
			return;
		}
		// require keys on first setup; allow saving without re-typing masked ones
		if (!cfg && (!apiKey.trim() || !secretKey.trim())) {
			setMessage({ ok: false, text: 'API key and Secret key are both required on first setup.' });
			return;
		}
		setSaving(true);
		setMessage(null);
		const res = await fetch('/api/admin/payment-gateways', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				enabled,
				mode,
				merchant_id: merchantId.trim(),
				api_key: apiKey.trim() || undefined,
				secret_key: secretKey.trim() || undefined,
				allowed_methods: [...methods],
				default_method: defaultMethod,
			}),
		});
		const json = await res.json();
		if (res.ok) {
			setMessage({
				ok: true,
				text: `Kashier ${enabled ? 'enabled' : 'saved'} (${mode} mode). Credentials are encrypted at rest.`,
			});
			setApiKey('');
			setSecretKey('');
			// refresh masks
			const refreshed = await fetch('/api/admin/payment-gateways');
			if (refreshed.ok) setCfg((await refreshed.json()).gateway);
		} else {
			setMessage({ ok: false, text: json.error ?? 'Save failed' });
		}
		setSaving(false);
	}

	if (loading) return <p className="text-sm text-[var(--nx-muted)]">Loading…</p>;

	const connected = Boolean(cfg?.api_key_masked);

	return (
		<div className="mx-auto max-w-3xl space-y-6">
			<header>
				<h1 className="text-xl font-semibold tracking-tight">Payment Gateways</h1>
				<p className="mt-0.5 text-sm text-[var(--nx-muted)]">
					Connect your Kashier account to accept plan payments in-place.
				</p>
			</header>

			{/* connection card */}
			<section className="rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-6">
				<div className="flex items-center gap-3">
					<div className="grid size-10 place-items-center rounded-xl bg-indigo-500/10">
						<Wallet size={20} className="text-indigo-400" />
					</div>
					<div className="flex-1">
						<p className="font-medium">Kashier</p>
						<p className="text-xs text-[var(--nx-muted)]">
							Cards · Mobile wallets · Fawry · BNPL — checkout embedded in your site
						</p>
					</div>
					<span
						className={`rounded-full px-2.5 py-0.5 text-[11px] ${
							connected
								? 'bg-emerald-500/10 text-emerald-400'
								: 'bg-zinc-700/40 text-zinc-400'
						}`}
					>
						{connected ? 'Connected' : 'Not connected'}
					</span>
				</div>

				<div className="mt-5 space-y-4">
					<label className="block">
						<span className="text-sm text-[var(--nx-muted)]">Merchant ID (MID)</span>
						<input
							value={merchantId}
							onChange={(e) => setMerchantId(e.target.value)}
							placeholder="MID-12345-6789"
							className="mt-1 w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-indigo-500"
						/>
					</label>

					<div className="grid gap-4 sm:grid-cols-2">
						<label className="block">
							<span className="text-sm text-[var(--nx-muted)]">
								API Key{' '}
								{connected && <span className="text-emerald-400">({cfg?.api_key_masked})</span>}
							</span>
							<input
								type="password"
								value={apiKey}
								onChange={(e) => setApiKey(e.target.value)}
								placeholder={connected ? 'Leave blank to keep current' : 'From Dashboard → Integrations'}
								className="mt-1 w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-500 placeholder:text-xs"
							/>
						</label>
						<label className="block">
							<span className="text-sm text-[var(--nx-muted)]">
								Secret Key{' '}
								{connected && (
									<span className="text-emerald-400">({cfg?.secret_key_masked})</span>
								)}
							</span>
							<input
								type="password"
								value={secretKey}
								onChange={(e) => setSecretKey(e.target.value)}
								placeholder={connected ? 'Leave blank to keep current' : 'From Dashboard → Integrations'}
								className="mt-1 w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-500 placeholder:text-xs"
							/>
						</label>
					</div>

					<div className="flex flex-wrap items-center gap-6">
						{/* mode toggle */}
						<div className="flex overflow-hidden rounded-lg border border-[var(--nx-border)]">
							<button
								onClick={() => setMode('test')}
								className={`px-4 py-1.5 text-sm ${mode === 'test' ? 'bg-amber-500/15 font-medium text-amber-400' : 'text-[var(--nx-muted)]'}`}
							>
								Test
							</button>
							<button
								onClick={() => setMode('live')}
								className={`px-4 py-1.5 text-sm ${mode === 'live' ? 'bg-emerald-500/15 font-medium text-emerald-400' : 'text-[var(--nx-muted)]'}`}
							>
								Live
							</button>
						</div>

						<label className="flex cursor-pointer items-center gap-2 text-sm">
							<input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
							Enable gateway
						</label>
					</div>

					{mode === 'live' && (
						<p className="flex items-center gap-2 rounded-lg bg-amber-500/10 px-4 py-2.5 text-xs text-amber-400">
							<AlertTriangle size={14} />
							Live mode charges real cards. Make sure your Kashier account is approved for live.
						</p>
					)}

					{/* methods */}
					<fieldset>
						<legend className="mb-2 text-sm text-[var(--nx-muted)]">Allowed payment methods</legend>
						<div className="grid gap-2 sm:grid-cols-2">
							{METHODS.map((m) => (
								<label key={m.id} className="flex cursor-pointer items-center gap-2 text-sm">
									<input
										type="checkbox"
										checked={methods.has(m.id)}
										onChange={(e) => {
											const next = new Set(methods);
											if (e.target.checked) next.add(m.id);
											else next.delete(m.id);
											setMethods(next);
										}}
									/>
									{m.label}
								</label>
							))}
						</div>
					</fieldset>

					<label className="block max-w-xs">
						<span className="text-sm text-[var(--nx-muted)]">Default method at checkout</span>
						<select
							value={defaultMethod}
							onChange={(e) => setDefaultMethod(e.target.value)}
							className="mt-1 w-full rounded-lg border border-[var(--nx-border)] bg-[var(--nx-surface)] px-3 py-2 text-sm outline-none focus:border-indigo-500"
						>
							{METHODS.map((m) => (
								<option key={m.id} value={m.id}>
									{m.label}
								</option>
							))}
						</select>
					</label>

					{message && (
						<p
							className={`flex items-center gap-2 text-sm ${
								message.ok ? 'text-emerald-400' : 'text-red-400'
							}`}
						>
							{message.ok ? <Check size={15} /> : <AlertTriangle size={15} />}
							{message.text}
						</p>
					)}

					<div className="flex items-center justify-between border-t border-[var(--nx-border)] pt-4">
						<a
							href="https://merchant.kashier.io"
							target="_blank"
							rel="noreferrer"
							className="flex items-center gap-1.5 text-xs text-[var(--nx-muted)] hover:text-indigo-300"
						>
							Get keys from Kashier Dashboard
							<ExternalLink size={12} />
						</a>
						<button
							onClick={save}
							disabled={saving}
							className="flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
						>
							{saving && <Loader2 size={14} className="animate-spin" />}
							Save configuration
						</button>
					</div>
				</div>
			</section>

			<p className="flex items-start gap-2 text-xs leading-relaxed text-[var(--nx-muted)]">
				<ShieldCheck size={14} className="mt-0.5 shrink-0" />
				Keys are AES-256-GCM encrypted before storage and never leave the server except inside
				signed checkout requests. Webhooks are verified with HMAC-SHA256 per Kashier&apos;s
				official signature scheme.
			</p>
		</div>
	);
}
