'use client';

import { useState } from 'react';
import { X, Plus, Trash2, Server, Globe } from 'lucide-react';
import type { ProviderRow } from './providers-client';

export function ProviderWizard(props: {
	onClose: () => void;
	onCreated: (p: ProviderRow) => void;
}) {
	const [step, setStep] = useState(1);
	const [kind, setKind] = useState<'custom' | 'openrouter'>('openrouter');
	const [name, setName] = useState('');
	const [baseUrl, setBaseUrl] = useState('');
	const [keys, setKeys] = useState<string[]>(['']);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function submit() {
		setBusy(true);
		setError(null);
		const res = await fetch('/api/admin/providers', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				kind,
				display_name: name,
				base_url: baseUrl,
				keys: keys.map((k) => k.trim()).filter(Boolean),
			}),
		});
		const json = await res.json();
		if (!res.ok) {
			setError(json.error ?? 'Failed');
			setBusy(false);
			return;
		}
		props.onCreated({
			...json.provider,
			keys_total: keys.filter(Boolean).length,
			models_total: 0,
			models_enabled: 0,
		});
	}

	return (
		<div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
			<div className="w-full max-w-lg rounded-2xl border border-[var(--nx-border)] bg-[var(--nx-surface)] shadow-2xl">
				<header className="flex items-center justify-between border-b border-[var(--nx-border)] px-6 py-4">
					<div>
						<h2 className="font-semibold">Add provider</h2>
						<p className="text-xs text-[var(--nx-muted)]">Step {step} of 2</p>
					</div>
					<button onClick={props.onClose} className="rounded-lg p-1.5 text-[var(--nx-muted)] hover:bg-zinc-800/60">
						<X size={18} />
					</button>
				</header>

				{step === 1 && (
					<div className="space-y-5 p-6">
						<p className="text-sm text-[var(--nx-muted)]">Choose the provider type.</p>
						<div className="grid grid-cols-2 gap-3">
							<KindCard
								active={kind === 'openrouter'}
								onClick={() => setKind('openrouter')}
								Icon={Globe}
								title="OpenRouter"
								desc="Access hundreds of models through one aggregated API."
							/>
							<KindCard
								active={kind === 'custom'}
								onClick={() => setKind('custom')}
								Icon={Server}
								title="Custom"
								desc="Any OpenAI-compatible base URL."
							/>
						</div>
						<label className="block">
							<span className="text-sm text-[var(--nx-muted)]">Display name</span>
							<input
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="e.g. OpenRouter"
								className="mt-1 w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-500"
							/>
						</label>
						{kind === 'custom' && (
							<label className="block">
								<span className="text-sm text-[var(--nx-muted)]">Base URL</span>
								<input
									value={baseUrl}
									onChange={(e) => setBaseUrl(e.target.value)}
									placeholder="https://api.example.com/v1"
									className="mt-1 w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-500"
								/>
							</label>
						)}
						<button
							disabled={!name.trim() || (kind === 'custom' && !baseUrl.trim())}
							onClick={() => setStep(2)}
							className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
						>
							Continue
						</button>
					</div>
				)}

				{step === 2 && (
					<div className="space-y-4 p-6">
						<p className="text-sm text-[var(--nx-muted)]">
							Add one or more API keys. Keys are encrypted at rest and never shown again.
						</p>
						{keys.map((k, i) => (
							<div key={i} className="flex gap-2">
								<input
									type="password"
									value={k}
									onChange={(e) => setKeys(keys.map((x, j) => (j === i ? e.target.value : x)))}
									placeholder={`API key #${i + 1}`}
									className="w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-500"
								/>
								<button
									onClick={() => setKeys(keys.filter((_, j) => j !== i))}
									disabled={keys.length === 1}
									className="rounded-lg p-2.5 text-[var(--nx-muted)] hover:bg-zinc-800/60 disabled:opacity-30"
								>
									<Trash2 size={16} />
								</button>
							</div>
						))}
						<button
							onClick={() => setKeys([...keys, ''])}
							className="flex items-center gap-1.5 text-sm text-indigo-400 hover:text-indigo-300"
						>
							<Plus size={15} />
							Add another key
						</button>
						{error && <p className="text-sm text-red-400">{error}</p>}
						<div className="flex gap-2 pt-1">
							<button
								onClick={() => setStep(1)}
								className="flex-1 rounded-lg border border-[var(--nx-border)] py-2.5 text-sm font-medium"
							>
								Back
							</button>
							<button
								onClick={submit}
								disabled={busy || !keys.some((k) => k.trim())}
								className="flex-1 rounded-lg bg-indigo-600 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
							>
								{busy ? 'Saving…' : 'Save & sync models'}
							</button>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

function KindCard(props: {
	active: boolean;
	onClick: () => void;
	Icon: typeof Server;
	title: string;
	desc: string;
}) {
	return (
		<button
			onClick={props.onClick}
			className={`rounded-xl border p-4 text-start transition ${
				props.active
					? 'border-indigo-500 bg-indigo-500/10'
					: 'border-[var(--nx-border)] hover:border-zinc-600'
			}`}
		>
			<props.Icon size={20} className={props.active ? 'text-indigo-400' : 'text-[var(--nx-muted)]'} />
			<p className="mt-2 text-sm font-medium">{props.title}</p>
			<p className="mt-0.5 text-xs text-[var(--nx-muted)]">{props.desc}</p>
		</button>
	);
}
