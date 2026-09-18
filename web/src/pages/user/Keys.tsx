import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Copy, Check, KeyRound } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { DashboardShell } from '../../components/DashboardShell';

interface KeyRow {
	id: string;
	name: string;
	prefix: string;
	last4: string;
	status: string;
	created_at: string;
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
	const [name, setName] = useState('');
	const [newKey, setNewKey] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const [busy, setBusy] = useState(false);

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

	async function createKey() {
		setBusy(true);
		const { ok, data } = await keysApi('POST', { action: 'create', name: name.trim() || undefined });
		if (!ok) {
			alert(data.error ?? 'Failed to create key');
		} else {
			setNewKey(data.key);
			setName('');
		}
		await load();
		setBusy(false);
	}

	async function destroyKey(id: string) {
		if (!window.confirm('Permanently delete this key? It stops working immediately and cannot be undone.')) return;
		const { ok, data } = await keysApi('DELETE', { key_id: id });
		if (!ok) alert(data.error ?? 'Failed to delete');
		await load();
	}

	return (
		<DashboardShell variant="user" email={email}>
			<div className="space-y-6">
				<header>
					<h1 className="text-xl font-semibold tracking-tight">API Keys</h1>
					<p className="mt-0.5 text-sm text-[var(--nx-muted)]">
						Keys are stored as one-way hashes — shown once at creation. Maximum 2 active keys.
					</p>
				</header>

				<div className="flex max-w-md flex-wrap gap-2">
					<input
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="Key name (e.g. my-app)"
						className="w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-cyan-500"
					/>
					<button
						onClick={createKey}
						disabled={busy || keys.length >= 2}
						className="flex shrink-0 items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-40"
					>
						<Plus size={15} />
						Create key
					</button>
				</div>

				{keys.length >= 2 && (
					<p className="text-xs text-amber-400">
						You've reached the 2-key limit — delete one to create another.
					</p>
				)}

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

				<div className="overflow-x-auto rounded-xl border border-[var(--nx-border)]">
					<table className="w-full min-w-[560px] text-sm">
						<thead className="bg-zinc-900/60 text-xs uppercase tracking-wide text-[var(--nx-muted)]">
							<tr>
								<th className="px-4 py-3 text-start">Name</th>
								<th className="px-4 py-3 text-start">Key</th>
								<th className="px-4 py-3 text-start">Status</th>
								<th className="px-4 py-3 text-start">Created</th>
								<th className="px-4 py-3" />
							</tr>
						</thead>
						<tbody className="divide-y divide-[var(--nx-border)]">
							{keys.map((k) => (
								<tr key={k.id}>
									<td className="px-4 py-3">{k.name}</td>
									<td className="px-4 py-3 font-mono text-xs text-[var(--nx-muted)]">{k.prefix}…{k.last4}</td>
									<td className="px-4 py-3">
										<span className={`rounded-full px-2 py-0.5 text-[11px] ${k.status === 'active' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
											{k.status}
										</span>
									</td>
									<td className="px-4 py-3 text-xs text-[var(--nx-muted)]">{k.created_at.slice(0, 10)}</td>
									<td className="px-4 py-3 text-end">
										<button onClick={() => destroyKey(k.id)} className="rounded-lg p-2 text-[var(--nx-muted)] hover:bg-red-500/10 hover:text-red-400" aria-label="Permanently delete">
											<Trash2 size={14} />
										</button>
									</td>
								</tr>
							))}
							{keys.length === 0 && (
								<tr>
									<td colSpan={5} className="px-4 py-10 text-center text-sm text-[var(--nx-muted)]">
										No keys yet — create your first one above.
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			</div>
		</DashboardShell>
	);
}
