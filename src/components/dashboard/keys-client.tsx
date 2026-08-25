'use client';

import { useCallback, useEffect, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { Plus, Trash2, Copy, Check, KeyRound } from 'lucide-react';

interface KeyRow {
	id: string;
	name: string;
	prefix: string;
	last4: string;
	status: string;
	created_at: string;
	last_used_at: string | null;
}

const KEY_PREFIX = 'sk-nexor-';

export function KeysClient() {
	const [keys, setKeys] = useState<KeyRow[]>([]);
	const [name, setName] = useState('');
	const [newKey, setNewKey] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const [busy, setBusy] = useState(false);

	const load = useCallback(async () => {
		const supabase = createBrowserClient(
			process.env.NEXT_PUBLIC_SUPABASE_URL!,
			process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
		);
		const { data: { user } } = await supabase.auth.getUser();
		if (!user) return;
		const { data } = await supabase
			.from('user_api_keys')
			.select('id,name,prefix,last4,status,created_at,last_used_at')
			.order('created_at', { ascending: false });
		setKeys(data ?? []);
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	async function createKey() {
		setBusy(true);
		const supabase = createBrowserClient(
			process.env.NEXT_PUBLIC_SUPABASE_URL!,
			process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
		);
		const { data: { user } } = await supabase.auth.getUser();
		if (!user) return;

		// generate locally; only the SHA-256 hash is stored server-side
		const raw = KEY_PREFIX + crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
		const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
		const hash = [...new Uint8Array(hashBuf)].map((b) => b.toString(16).padStart(2, '0')).join('');

		const { error } = await supabase.from('user_api_keys').insert({
			user_id: user.id,
			name: name.trim() || 'default',
			prefix: raw.slice(0, 12),
			last4: raw.slice(-4),
			sha256_hash: hash,
		});
		if (!error) {
			setNewKey(raw);
			setName('');
		}
		await load();
		setBusy(false);
	}

	async function revoke(id: string) {
		const supabase = createBrowserClient(
			process.env.NEXT_PUBLIC_SUPABASE_URL!,
			process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
		);
		await supabase.from('user_api_keys').update({ status: 'revoked' }).eq('id', id);
		await load();
	}

	return (
		<div className="space-y-6">
			<header>
				<h1 className="text-xl font-semibold tracking-tight">API Keys</h1>
				<p className="mt-0.5 text-sm text-[var(--nx-muted)]">
					Keys are stored as one-way hashes — shown once at creation.
				</p>
			</header>

			{/* create */}
			<div className="flex max-w-md gap-2">
				<input
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="Key name (e.g. my-app)"
					className="w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-500"
				/>
				<button
					onClick={createKey}
					disabled={busy}
					className="flex shrink-0 items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
				>
					<Plus size={15} />
					Create key
				</button>
			</div>

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
							className="shrink-0 rounded-lg border border-[var(--nx-border)] p-2 hover:text-indigo-300"
							aria-label="Copy"
						>
							{copied ? <Check size={15} className="text-emerald-400" /> : <Copy size={15} />}
						</button>
					</div>
				</div>
			)}

			<div className="overflow-hidden rounded-xl border border-[var(--nx-border)]">
				<table className="w-full text-sm">
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
								<td className="px-4 py-3 font-mono text-xs text-[var(--nx-muted)]">
									{k.prefix}…{k.last4}
								</td>
								<td className="px-4 py-3">
									<span
										className={`rounded-full px-2 py-0.5 text-[11px] ${
											k.status === 'active'
												? 'bg-emerald-500/10 text-emerald-400'
												: 'bg-red-500/10 text-red-400'
										}`}
									>
										{k.status}
									</span>
								</td>
								<td className="px-4 py-3 text-xs text-[var(--nx-muted)]">
									{k.created_at.slice(0, 10)}
								</td>
								<td className="px-4 py-3 text-end">
									{k.status === 'active' && (
										<button
											onClick={() => revoke(k.id)}
											className="rounded-lg p-2 text-[var(--nx-muted)] hover:bg-red-500/10 hover:text-red-400"
											aria-label="Revoke"
										>
											<Trash2 size={14} />
										</button>
									)}
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
	);
}
