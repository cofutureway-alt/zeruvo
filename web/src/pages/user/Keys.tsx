import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Copy, Check, KeyRound, X, Search, ShieldCheck, Infinity as InfinityIcon } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { DashboardShell } from '../../components/DashboardShell';
import { Turnstile } from '../../components/Turnstile';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useAppSettings } from '../../hooks/useAppSettings';
import { PageHeader, Pill, EmptyState } from '../../components/console-kit';

interface KeyRow {
	id: string;
	name: string;
	prefix: string;
	last4: string;
	status: string;
	created_at: string;
	allowed_models: string[];
	spend_limit_usd: number | null;
	total_spent_usd: number | null;
}

interface PickModel {
	id: string;
	display_name: string;
	upstream_model_id: string;
}

/** Calls the api-keys Edge Function with the user's session JWT. */
async function keysApi(method: 'GET' | 'POST' | 'DELETE', body?: unknown) {
	const { data: { session } } = await supabase.auth.getSession();
	const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/api-keys`, {
		method,
		headers: {
			Authorization: `Bearer ${session?.access_token ?? ''}`,
			'Content-Type': 'application/json',
		},
		body: body ? JSON.stringify(body) : undefined,
	});
	return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

export default function Keys() {
	const [email, setEmail] = useState('');
	const [keys, setKeys] = useState<KeyRow[]>([]);
	const [newKey, setNewKey] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const settings = useAppSettings();

	// create-key popup state
	const [open, setOpen] = useState(false);
	const [name, setName] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [spendLimit, setSpendLimit] = useState('');
	const [models, setModels] = useState<PickModel[]>([]);
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [query, setQuery] = useState('');
	const [captchaToken, setCaptchaToken] = useState('');
	const needCaptcha = !!settings?.turnstile_enabled && !!settings.turnstile_on_api_key;

	const load = useCallback(async () => {
		const { data: { user } } = await supabase.auth.getUser();
		if (!user) return;
		setEmail(user.email ?? '');
		const { ok, data } = await keysApi('GET');
		if (ok) setKeys(data.keys ?? []);
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	useEffect(() => {
		if (!open) return;
		void supabase
			.from('models_public_view')
			.select('id,display_name,upstream_model_id')
			.eq('enabled_for_users', true)
			.eq('is_priced', true)
			.order('display_name')
			.limit(400)
			.then(({ data }) => setModels((data ?? []) as PickModel[]));
	}, [open]);

	const filteredModels = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return models;
		return models.filter((m) => m.display_name.toLowerCase().includes(q) || m.upstream_model_id.toLowerCase().includes(q));
	}, [models, query]);

	async function createKey() {
		if (needCaptcha && !captchaToken) {
			setError('Please complete the captcha.');
			return;
		}
		setBusy(true);
		setError(null);
		const limit = spendLimit.trim() === '' ? null : Number(spendLimit);
		if (limit != null && (!Number.isFinite(limit) || limit < 0)) {
			setError('Spend limit must be a positive number or empty (unlimited).');
			setBusy(false);
			return;
		}
		const { ok, data } = await keysApi('POST', {
			action: 'create',
			name: name.trim() || undefined,
			allowed_models: selected.size ? [...selected] : [],
			spend_limit_usd: limit,
			turnstile_token: captchaToken || undefined,
		});
		if (!ok) {
			setError(data.error ?? 'Failed to create key');
		} else {
			setNewKey(data.key);
			setOpen(false);
			setName('');
			setSpendLimit('');
			setSelected(new Set());
			setCaptchaToken('');
		}
		await load();
		setBusy(false);
	}

	// delete-confirmation state
	const [confirmKey, setConfirmKey] = useState<KeyRow | null>(null);
	const [deleting, setDeleting] = useState(false);
	const [deleteError, setDeleteError] = useState<string | null>(null);

	async function destroyKey(id: string) {
		setDeleting(true);
		setDeleteError(null);
		const { ok, data } = await keysApi('DELETE', { key_id: id });
		setDeleting(false);
		if (!ok) {
			setDeleteError(data.error ?? 'Failed to delete — please try again.');
			return;
		}
		setConfirmKey(null);
		await load();
	}

	return (
		<DashboardShell variant="user" email={email}>
			<div className="space-y-6">
				<PageHeader
					title="API Keys"
					subtitle="Keys are stored as one-way hashes — shown once at creation. Maximum 2 active keys."
					actions={
						<button
							onClick={() => setOpen(true)}
							disabled={keys.length >= 2}
							className="flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-40"
						>
							<Plus size={15} /> New API key
						</button>
					}
				/>

				{newKey && (
					<div className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-4">
						<p className="flex items-center gap-2 text-sm font-medium text-emerald-400">
							<KeyRound size={15} />
							Copy your key now — it will not be shown again
						</p>
						<div className="mt-3 flex items-center gap-2">
							<code dir="ltr" className="min-w-0 flex-1 truncate rounded-lg bg-zinc-900 px-3 py-2 font-mono text-xs">
								{newKey}
							</code>
							<button
								onClick={async () => {
									await navigator.clipboard.writeText(newKey);
									setCopied(true);
									setTimeout(() => setCopied(false), 1500);
								}}
								className="shrink-0 rounded-lg border border-[var(--nx-border)] p-2 hover:text-cyan-300"
								aria-label="Copy"
							>
								{copied ? <Check size={15} className="text-emerald-400" /> : <Copy size={15} />}
							</button>
						</div>
					</div>
				)}

				{keys.length === 0 ? (
					<EmptyState
						icon={<KeyRound size={28} />}
						title="No API keys yet"
						hint="Create your first key to start calling the gateway. You can scope it to specific models and cap its spending."
					/>
				) : (
					<div className="overflow-x-auto rounded-xl border border-[var(--nx-border)]">
						<table className="w-full min-w-[720px] text-sm">
							<thead className="bg-zinc-900/60 font-data text-[11px] uppercase tracking-wider text-[var(--nx-muted)]">
								<tr>
									<th className="px-4 py-3 text-start">Name</th>
									<th className="px-4 py-3 text-start">Key</th>
									<th className="px-4 py-3 text-start">Models</th>
									<th className="px-4 py-3 text-start">Spend limit</th>
									<th className="px-4 py-3 text-start">Spent</th>
									<th className="px-4 py-3 text-start">Created</th>
									<th className="px-4 py-3" />
								</tr>
							</thead>
							<tbody className="divide-y divide-[var(--nx-border)]">
								{keys.map((k) => {
									const limitReached = k.spend_limit_usd != null && Number(k.total_spent_usd ?? 0) >= Number(k.spend_limit_usd);
									return (
										<tr key={k.id} className="transition-colors hover:bg-cyan-500/[0.03]">
											<td className="px-4 py-3 font-medium">{k.name}</td>
											<td className="px-4 py-3 font-mono text-xs text-[var(--nx-muted)]">{k.prefix}…{k.last4}</td>
											<td className="px-4 py-3">
												{k.allowed_models?.length
													? <Pill tone="teal">{k.allowed_models.length} scoped</Pill>
													: <Pill tone="gray"><InfinityIcon size={11} /> all</Pill>}
											</td>
											<td className="px-4 py-3 font-data text-xs tabular-nums">
												{k.spend_limit_usd != null
													? (limitReached
														? <span className="text-red-400">${Number(k.spend_limit_usd).toFixed(2)} (reached)</span>
														: <span>${Number(k.spend_limit_usd).toFixed(2)}</span>)
													: <span className="text-[var(--nx-muted)]">unlimited</span>}
											</td>
											<td className="px-4 py-3 font-data text-xs tabular-nums">${Number(k.total_spent_usd ?? 0).toFixed(4)}</td>
											<td className="px-4 py-3 text-xs text-[var(--nx-muted)]">{k.created_at.slice(0, 10)}</td>
											<td className="px-4 py-3 text-end">
												<button onClick={() => { setDeleteError(null); setConfirmKey(k); }} className="rounded-lg p-2 text-[var(--nx-muted)] hover:bg-red-500/10 hover:text-red-400" aria-label="Permanently delete">
													<Trash2 size={14} />
												</button>
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				)}
			</div>

			{open && (
				<div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
					<div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-[var(--nx-border)] bg-[var(--nx-surface)] shadow-2xl">
						<header className="flex items-center justify-between border-b border-[var(--nx-border)] px-6 py-4">
							<div>
								<h2 className="font-semibold">New API key</h2>
								<p className="text-xs text-[var(--nx-muted)]">Scope it to specific models and optionally cap its spending.</p>
							</div>
							<button onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-[var(--nx-muted)] hover:bg-zinc-800/60">
								<X size={18} />
							</button>
						</header>

						<div className="space-y-4 overflow-y-auto px-6 py-4">
							{error && (
								<div className="rounded-lg bg-red-500/10 px-4 py-2.5 text-sm text-red-400">{error}</div>
							)}

							<label className="block">
								<span className="text-xs font-medium text-[var(--nx-muted)]">Key name</span>
								<input
									value={name}
									onChange={(e) => setName(e.target.value)}
									placeholder="my-app"
									className="mt-1 w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-cyan-500"
								/>
							</label>

							<label className="block">
								<span className="text-xs font-medium text-[var(--nx-muted)]">
									Spend limit (USD) — leave empty for unlimited
								</span>
								<input
									value={spendLimit}
									onChange={(e) => setSpendLimit(e.target.value)}
									placeholder="e.g. 25"
									inputMode="decimal"
									dir="ltr"
									className="mt-1 w-44 rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 font-data text-sm tabular-nums outline-none focus:border-cyan-500"
								/>
							</label>

							<div>
								<div className="flex items-center justify-between gap-2">
									<span className="text-xs font-medium text-[var(--nx-muted)]">
										Models — {selected.size === 0 ? 'all models allowed' : `${selected.size} selected`}
									</span>
									{selected.size > 0 && (
										<button onClick={() => setSelected(new Set())} className="text-xs text-red-400 hover:text-red-300">
											Clear
										</button>
									)}
								</div>
								<label className="relative mt-1.5 block">
									<Search size={14} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-[var(--nx-muted)]" />
									<input
										value={query}
										onChange={(e) => setQuery(e.target.value)}
										placeholder="Filter models…"
										className="w-full rounded-lg border border-[var(--nx-border)] bg-transparent py-2 pe-3 ps-9 text-sm outline-none focus:border-cyan-500"
									/>
								</label>
								<div className="mt-2 max-h-56 divide-y divide-[var(--nx-border)] overflow-y-auto rounded-lg border border-[var(--nx-border)]">
									{filteredModels.slice(0, 200).map((m) => {
										const on = selected.has(m.id);
										return (
											<button
												key={m.id}
												onClick={() => {
													const next = new Set(selected);
													if (on) next.delete(m.id);
													else next.add(m.id);
													setSelected(next);
												}}
												className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-start text-sm transition-colors ${on ? 'bg-cyan-500/10' : 'hover:bg-cyan-500/5'}`}
											>
												<span className="min-w-0 truncate">{m.display_name}</span>
												<span className={`grid size-4 shrink-0 place-items-center rounded border ${on ? 'border-cyan-400 bg-cyan-500/20 text-cyan-300' : 'border-[var(--nx-border)]'}`}>
													{on && <Check size={11} />}
												</span>
											</button>
										);
									})}
									{filteredModels.length === 0 && (
										<p className="px-3 py-6 text-center text-xs text-[var(--nx-muted)]">No models match.</p>
									)}
								</div>
							</div>

							{needCaptcha && (
								<div className="rounded-lg border border-[var(--nx-border)] p-3">
									<p className="mb-2 flex items-center gap-1.5 text-xs text-[var(--nx-muted)]">
										<ShieldCheck size={13} className="text-cyan-400" /> Human verification
									</p>
									<Turnstile siteKey={settings!.turnstile_site_key} onToken={setCaptchaToken} />
								</div>
							)}
						</div>

						<footer className="flex items-center justify-end gap-2 border-t border-[var(--nx-border)] px-6 py-4">
							<button onClick={() => setOpen(false)} className="rounded-lg border border-[var(--nx-border)] px-4 py-2 text-sm">
								Cancel
							</button>
							<button
								onClick={createKey}
								disabled={busy || (needCaptcha && !captchaToken)}
								className="rounded-lg bg-cyan-600 px-5 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-40"
							>
								{busy ? 'Creating…' : 'Create key'}
							</button>
						</footer>
					</div>
				</div>
			)}

			<ConfirmDialog
				open={!!confirmKey}
				title={`Delete "${confirmKey?.name ?? ''}"?`}
				body="The key stops working immediately and is removed permanently — this cannot be undone."
				error={deleteError}
				busy={deleting}
				confirmLabel="Delete key"
				onConfirm={() => confirmKey && destroyKey(confirmKey.id)}
				onCancel={() => setConfirmKey(null)}
			/>
		</DashboardShell>
	);
}
