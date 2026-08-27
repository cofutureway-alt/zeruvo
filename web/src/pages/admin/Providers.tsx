import { useCallback, useEffect, useState } from 'react';
import {
	Plus, KeyRound, Layers, Pencil, Trash2, Zap, RefreshCw,
	CheckCircle2, XCircle, Loader2,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { DashboardShell } from '../../components/DashboardShell';
import { edgeCall } from '../../lib/admin-api';
import { ModelSelector } from '../../components/admin/ModelSelector';

export interface ProviderRow {
	id: string;
	kind: 'custom' | 'openrouter';
	display_name: string;
	base_url: string;
	status: string;
	keys_total: number;
	models_total: number;
	models_enabled: number;
}

interface KeyRow {
	id: string;
	label: string;
	weight: number | string;
	dead_until: string | null;
	last_error_code: number | null;
}

type TestResult = Record<string, { ok: boolean; detail: string; latency_ms?: number; model_count?: number }>;

export default function Providers() {
	const [email, setEmail] = useState('');
	const [providers, setProviders] = useState<ProviderRow[]>([]);
	const [wizardOpen, setWizardOpen] = useState(false);
	const [selectorFor, setSelectorFor] = useState<ProviderRow | null>(null);
	const [editing, setEditing] = useState<ProviderRow | null>(null);
	const [keysFor, setKeysFor] = useState<ProviderRow | null>(null);
	const [confirmDelete, setConfirmDelete] = useState<ProviderRow | null>(null);
	const [syncing, setSyncing] = useState<string | null>(null);

	const load = useCallback(async () => {
		const { data: { user } } = await supabase.auth.getUser();
		setEmail(user?.email ?? '');
		const [{ data: provs }, { data: keys }, { data: models }] = await Promise.all([
			supabase.from('providers').select('*').order('created_at', { ascending: false }),
			supabase.from('provider_keys').select('id,provider_id'),
			supabase.from('models').select('id,provider_id,enabled_for_users'),
		]);
		setProviders(
			(provs ?? []).map((p) => ({
				...p,
				keys_total: keys?.filter((k) => k.provider_id === p.id).length ?? 0,
				models_total: models?.filter((m) => m.provider_id === p.id).length ?? 0,
				models_enabled: models?.filter((m) => m.provider_id === p.id && m.enabled_for_users).length ?? 0,
			})),
		);
	}, []);

	useEffect(() => { void load(); }, [load]);

	async function syncModels(p: ProviderRow) {
		setSyncing(p.id);
		await edgeCall('admin-sync-models', { provider_id: p.id });
		setSyncing(null);
		void load();
	}

	async function doDelete() {
		if (!confirmDelete) return;
		await supabase.from('providers').delete().eq('id', confirmDelete.id);
		setConfirmDelete(null);
		void load();
	}

	return (
		<DashboardShell variant="admin" email={email}>
			<div className="space-y-6">
				<header className="flex items-center justify-between">
					<div>
						<h1 className="font-display text-xl font-semibold tracking-tight">Providers</h1>
						<p className="mt-0.5 text-sm text-[var(--nx-muted)]">Connect upstream providers, manage their API keys and curate model catalogs.</p>
					</div>
					<button
						onClick={() => setWizardOpen(true)}
						className="flex items-center gap-2 rounded-xl bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_0_24px_rgba(6,182,212,0.25)] transition hover:bg-cyan-500"
					>
						<Plus size={16} /> Add provider
					</button>
				</header>

				{providers.length === 0 ? (
					<div className="grid place-items-center rounded-2xl border border-dashed border-[var(--nx-border)] py-24">
						<p className="text-sm text-[var(--nx-muted)]">No providers yet — add your first one.</p>
					</div>
				) : (
					<div className="grid gap-4 xl:grid-cols-2">
						{providers.map((p) => (
							<article key={p.id} className="spotlight-card p-6">
								<div className="flex items-start justify-between gap-3">
									<div className="min-w-0">
										<h3 className="truncate font-display text-lg font-semibold">{p.display_name}</h3>
										<p className="mt-0.5 truncate font-data text-[11px] text-[var(--nx-muted)]">{p.base_url}</p>
									</div>
									<span className={`shrink-0 rounded-full px-2.5 py-0.5 font-data text-[11px] ${p.status === 'active' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-700/40 text-zinc-400'}`}>
										{p.status}
									</span>
								</div>

								<div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--nx-muted)]">
									<span className="flex items-center gap-1.5"><KeyRound size={13} /> {p.keys_total} key{p.keys_total === 1 ? '' : 's'}</span>
									<span>{p.models_enabled}/{p.models_total} live</span>
								</div>

								{/* actions */}
								<div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
									<ActionButton onClick={() => setKeysFor(p)} Icon={KeyRound} label="Keys" />
									<ActionButton onClick={() => setSelectorFor(p)} Icon={Layers} label="Models" />
									<ActionButton onClick={() => syncModels(p)} Icon={syncing === p.id ? Loader2 : RefreshCw} label="Sync" spin={syncing === p.id} />
									<ActionButton onClick={() => setEditing(p)} Icon={Pencil} label="Edit" />
								</div>
								<button
									onClick={() => setConfirmDelete(p)}
									className="mt-2 w-full rounded-lg border border-transparent py-1.5 text-xs text-[var(--nx-muted)] transition hover:border-red-500/30 hover:bg-red-500/5 hover:text-red-400"
								>
									Delete provider
								</button>
							</article>
						))}
					</div>
				)}
			</div>

			{wizardOpen && (
				<CreateProviderModal
					onClose={() => setWizardOpen(false)}
					onCreated={() => { setWizardOpen(false); void load(); }}
				/>
			)}
			{editing && (
				<EditProviderModal
					provider={editing}
					onClose={() => setEditing(null)}
					onSaved={() => { setEditing(null); void load(); }}
				/>
			)}
			{keysFor && (
				<KeysManagerModal provider={keysFor} onClose={() => setKeysFor(null)} />
			)}
			{selectorFor && (
				<ModelSelector provider={selectorFor} onClose={() => { setSelectorFor(null); void load(); }} />
			)}
			{confirmDelete && (
				<ConfirmModal
					title={`Delete ${confirmDelete.display_name}?`}
					body={`This permanently removes the provider, its ${confirmDelete.keys_total} key(s) and its ${confirmDelete.models_total} model(s) from the catalog.`}
					confirmLabel="Delete permanently"
					onCancel={() => setConfirmDelete(null)}
					onConfirm={doDelete}
				/>
			)}
		</DashboardShell>
	);
}

function ActionButton(props: { onClick: () => void; Icon: typeof KeyRound; label: string; spin?: boolean }) {
	return (
		<button
			onClick={props.onClick}
			className="flex items-center justify-center gap-1.5 rounded-lg border border-[var(--nx-border)] py-2 text-xs font-medium text-zinc-200 transition hover:border-cyan-500/60 hover:text-cyan-300"
		>
			<props.Icon size={13} className={props.spin ? 'animate-spin' : ''} />
			{props.label}
		</button>
	);
}

/* ---------- create modal ---------- */
function CreateProviderModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
	const [kind, setKind] = useState<'custom' | 'openrouter'>('openrouter');
	const [name, setName] = useState('');
	const [baseUrl, setBaseUrl] = useState('');
	const [key, setKey] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function submit() {
		if (!name.trim()) return setError('Name is required');
		setBusy(true); setError(null);
		const res = await edgeCall<{ error?: string }>('admin-providers', {
			action: 'create_provider',
			kind,
			display_name: name.trim(),
			base_url: kind === 'openrouter' ? undefined : baseUrl.trim(),
		});
		if (res?.error) { setError(res.error); setBusy(false); return; }
		// optional first key
		if (key.trim()) {
			const created = await supabase.from('providers').select('id').eq('display_name', name.trim()).maybeSingle();
			if (created.data?.id) {
				await edgeCall('admin-providers', {
					action: 'add_key', provider_id: created.data.id, api_key: key.trim(),
				});
			}
		}
		onCreated();
	}

	return (
		<Modal title="Add provider" onClose={onClose}>
			<div className="space-y-4">
				<div className="grid grid-cols-2 gap-3">
					{(['openrouter', 'custom'] as const).map((k) => (
						<button
							key={k}
							onClick={() => setKind(k)}
							className={`rounded-xl border px-4 py-3 text-sm capitalize transition ${kind === k ? 'border-cyan-500 bg-cyan-500/10 text-cyan-300' : 'border-[var(--nx-border)] text-[var(--nx-muted)] hover:border-zinc-600'}`}
						>
							{k === 'openrouter' ? 'OpenRouter' : 'Custom (OpenAI-compatible)'}
						</button>
					))}
				</div>
				<Field label="Display name" value={name} onChange={setName} placeholder="e.g. OpenRouter" />
				{kind === 'custom' && <Field label="Base URL" value={baseUrl} onChange={setBaseUrl} placeholder="https://api.example.com/v1" mono />}
				<Field label="First API key (optional — add more later)" value={key} onChange={setKey} placeholder="sk-…" password />
				{error && <p className="text-sm text-red-400">{error}</p>}
				<button onClick={submit} disabled={busy} className="w-full rounded-xl bg-cyan-600 py-2.5 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-40">
					{busy ? 'Creating…' : 'Create provider'}
				</button>
			</div>
		</Modal>
	);
}

/* ---------- edit modal ---------- */
function EditProviderModal({ provider, onClose, onSaved }: { provider: ProviderRow; onClose: () => void; onSaved: () => void }) {
	const [name, setName] = useState(provider.display_name);
	const [baseUrl, setBaseUrl] = useState(provider.base_url);
	const [status, setStatus] = useState(provider.status);
	const [busy, setBusy] = useState(false);

	async function save() {
		setBusy(true);
		await edgeCall('admin-providers', {
			action: 'update_provider',
			provider_id: provider.id,
			display_name: name.trim(),
			base_url: baseUrl.trim(),
			status,
		});
		setBusy(false);
		onSaved();
	}

	return (
		<Modal title={`Edit ${provider.display_name}`} onClose={onClose}>
			<div className="space-y-4">
				<Field label="Display name" value={name} onChange={setName} />
				<Field label="Base URL" value={baseUrl} onChange={setBaseUrl} mono />
				<label className="block">
					<span className="text-sm text-[var(--nx-muted)]">Status</span>
					<select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--nx-border)] bg-[var(--nx-surface)] px-3 py-2 text-sm outline-none focus:border-cyan-500">
						<option value="active">Active</option>
						<option value="disabled">Disabled</option>
					</select>
				</label>
				<button onClick={save} disabled={busy} className="w-full rounded-xl bg-cyan-600 py-2.5 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-40">
					{busy ? 'Saving…' : 'Save changes'}
				</button>
			</div>
		</Modal>
	);
}

/* ---------- keys manager ---------- */
function KeysManagerModal({ provider, onClose }: { provider: ProviderRow; onClose: () => void }) {
	const [keys, setKeys] = useState<KeyRow[]>([]);
	const [newKey, setNewKey] = useState('');
	const [weight, setWeight] = useState('1');
	const [busy, setBusy] = useState(false);
	const [testing, setTesting] = useState<string | null>(null);
	const [results, setResults] = useState<TestResult>({});
	const [error, setError] = useState<string | null>(null);

	async function load() {
		const { data } = await supabase
			.from('provider_keys')
			.select('id,label,weight,dead_until,last_error_code')
			.eq('provider_id', provider.id)
			.order('created_at');
		setKeys((data ?? []) as KeyRow[]);
	}

	useEffect(() => { void load(); /* eslint-disable-next-line */ }, [provider.id]);

	async function addKey() {
		if (!newKey.trim()) return;
		setBusy(true); setError(null);
		const res = await edgeCall<{ error?: string }>('admin-providers', {
			action: 'add_key', provider_id: provider.id, api_key: newKey.trim(), weight: Number(weight) || 1,
		});
		if (res?.error) setError(res.error);
		else { setNewKey(''); setWeight('1'); await load(); }
		setBusy(false);
	}

	async function deleteKey(id: string) {
		await edgeCall('admin-providers', { action: 'delete_key', key_id: id });
		await load();
	}

	async function testKey(id: string) {
		setTesting(id);
		const res = await edgeCall<{ ok: boolean; status: number; latency_ms: number; model_count: number; detail: string }>(
			'admin-providers', { action: 'test_key', key_id: id },
		);
		setResults((r) => ({ ...r, [id]: res ?? { ok: false, detail: 'request failed' } }));
		setTesting(null);
		load();
	}

	return (
		<Modal title={`API Keys — ${provider.display_name}`} onClose={onClose} wide>
			<div className="space-y-4">
				{/* add row */}
				<div className="flex flex-wrap gap-2">
					<input
						type="password" value={newKey} onChange={(e) => setNewKey(e.target.value)}
						placeholder="Paste API key…"
						className="min-w-48 flex-1 rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-cyan-500"
					/>
					<input
						type="number" min={0.5} step="any" value={weight} onChange={(e) => setWeight(e.target.value)}
						placeholder="weight" title="Selection weight for load balancing"
						className="w-20 rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm tabular-nums outline-none focus:border-cyan-500"
					/>
					<button onClick={addKey} disabled={busy || !newKey.trim()} className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-40">
						<Plus size={14} /> Add
					</button>
				</div>
				{error && <p className="text-sm text-red-400">{error}</p>}

				{/* key list */}
				{keys.length === 0 ? (
					<p className="rounded-lg border border-dashed border-[var(--nx-border)] py-8 text-center text-sm text-[var(--nx-muted)]">No keys yet.</p>
				) : (
					<ul className="space-y-2">
						{keys.map((k, i) => {
							const t = results[k.id];
							const dead = k.dead_until && new Date(k.dead_until) > new Date();
							return (
								<li key={k.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--nx-border)] px-4 py-3">
									<span className="font-data text-xs text-zinc-300">{k.label}</span>
									<span className="font-data text-[11px] tabular-nums text-[var(--nx-muted)]">w:{Number(k.weight)}</span>
									{dead && <span className="rounded-full bg-red-500/10 px-2 py-0.5 font-data text-[10px] text-red-400">dead until {new Date(k.dead_until!).toLocaleTimeString()}</span>}
									{t && (
										t.ok ? (
											<span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-400">
												<CheckCircle2 size={11} /> ok · {t.model_count} models · {t.latency_ms}ms
											</span>
										) : (
											<span className="flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] text-red-400">
												<XCircle size={11} /> fail · {t.detail}
											</span>
										)
									)}
									<span className="ms-auto flex items-center gap-1">
										<button onClick={() => testKey(k.id)} disabled={testing === k.id} className="flex items-center gap-1 rounded-lg border border-[var(--nx-border)] px-2.5 py-1.5 text-xs text-zinc-200 transition hover:border-mint hover:text-[var(--nx-mint)] disabled:opacity-40" title="Live probe against upstream /models">
											{testing === k.id ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
											Test
										</button>
										<button onClick={() => deleteKey(k.id)} className="rounded-lg p-1.5 text-[var(--nx-muted)] hover:bg-red-500/10 hover:text-red-400" aria-label="Delete key">
											<Trash2 size={13} />
										</button>
									</span>
									{i === 0 && !t && <span className="hidden text-[10px] text-[var(--nx-muted)] sm:inline">Test runs a real /models call upstream.</span>}
								</li>
							);
						})}
					</ul>
				)}
				<p className="text-[11px] leading-relaxed text-[var(--nx-muted)]">
					Weights bias traffic when multiple live keys exist. The gateway auto-marks keys dead on 401/402/403 and rotates on 429.
				</p>
			</div>
		</Modal>
	);
}

/* ---------- shared bits ---------- */
function Modal({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
	return (
		<div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm">
			<div className={`w-full ${wide ? 'max-w-2xl' : 'max-w-md'} rounded-2xl border border-[var(--nx-border)] bg-[var(--nx-surface)] shadow-2xl`}>
				<header className="flex items-center justify-between border-b border-[var(--nx-border)] px-6 py-4">
					<h2 className="font-display font-semibold">{title}</h2>
					<button onClick={onClose} className="rounded-lg p-1.5 text-[var(--nx-muted)] hover:bg-zinc-800/60"><XCircleIcon /></button>
				</header>
				<div className="p-6">{children}</div>
			</div>
		</div>
	);
}

import { X as XClose } from 'lucide-react';
function XCircleIcon() { return <XClose size={18} />; }

function Field(props: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean; password?: boolean }) {
	return (
		<label className="block">
			<span className="text-sm text-[var(--nx-muted)]">{props.label}</span>
			<input
				type={props.password ? 'password' : 'text'}
				value={props.value}
				onChange={(e) => props.onChange(e.target.value)}
				placeholder={props.placeholder}
				className={`mt-1 w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-cyan-500 ${props.mono || props.password ? 'font-mono' : ''}`}
			/>
		</label>
	);
}

export function ConfirmModal({ title, body, confirmLabel, onCancel, onConfirm }: { title: string; body: string; confirmLabel: string; onCancel: () => void; onConfirm: () => void }) {
	return (
		<div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
			<div className="w-full max-w-sm rounded-2xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-6 shadow-2xl">
				<h3 className="font-display font-semibold text-red-400">{title}</h3>
				<p className="mt-2 text-sm leading-relaxed text-[var(--nx-muted)]">{body}</p>
				<div className="mt-5 flex gap-2">
					<button onClick={onCancel} className="flex-1 rounded-lg border border-[var(--nx-border)] py-2 text-sm">Cancel</button>
					<button onClick={onConfirm} className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-medium text-white hover:bg-red-500">{confirmLabel}</button>
				</div>
			</div>
		</div>
	);
}
