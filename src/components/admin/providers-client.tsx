'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCw, KeyRound, Layers, Eye, EyeOff } from 'lucide-react';
import { ProviderWizard } from './provider-wizard';
import { ModelSelector } from './model-selector';

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

export function ProvidersClient() {
	const [providers, setProviders] = useState<ProviderRow[]>([]);
	const [wizardOpen, setWizardOpen] = useState(false);
	const [selectorFor, setSelectorFor] = useState<ProviderRow | null>(null);
	const [loading, setLoading] = useState(true);

	const load = useCallback(async () => {
		setLoading(true);
		const res = await fetch('/api/admin/providers');
		if (res.ok) setProviders((await res.json()).providers);
		setLoading(false);
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	return (
		<div className="space-y-6">
			<header className="flex items-center justify-between">
				<div>
					<h1 className="text-xl font-semibold tracking-tight">Providers</h1>
					<p className="mt-0.5 text-sm text-[var(--nx-muted)]">
						Connect upstream AI providers and curate their model catalogs.
					</p>
				</div>
				<button
					onClick={() => setWizardOpen(true)}
					className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500"
				>
					<Plus size={16} />
					Add provider
				</button>
			</header>

			{loading ? (
				<p className="text-sm text-[var(--nx-muted)]">Loading…</p>
			) : providers.length === 0 ? (
				<EmptyState onAdd={() => setWizardOpen(true)} />
			) : (
				<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
					{providers.map((p) => (
						<article
							key={p.id}
							className="group rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-5 transition hover:border-indigo-500/40"
						>
							<div className="flex items-start justify-between gap-3">
								<div className="min-w-0">
									<h3 className="truncate font-medium">{p.display_name}</h3>
									<p className="mt-0.5 truncate text-xs text-[var(--nx-muted)]">{p.base_url}</p>
								</div>
								<span
									className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
										p.status === 'active'
											? 'bg-emerald-500/10 text-emerald-400'
											: 'bg-zinc-700/40 text-zinc-400'
									}`}
								>
									{p.status}
								</span>
							</div>
							<div className="mt-4 flex items-center gap-4 text-xs text-[var(--nx-muted)]">
								<span className="flex items-center gap-1.5">
									<KeyRound size={13} /> {p.keys_total} keys
								</span>
								<span className="flex items-center gap-1.5">
									<Eye size={13} /> {p.models_enabled}/{p.models_total} live
								</span>
							</div>
							<button
								onClick={() => setSelectorFor(p)}
								className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--nx-border)] py-2 text-sm font-medium text-zinc-200 transition group-hover:border-indigo-500/50 group-hover:text-indigo-300"
							>
								<Layers size={15} />
								Manage models
							</button>
						</article>
					))}
				</div>
			)}

			{wizardOpen && (
				<ProviderWizard
					onClose={() => setWizardOpen(false)}
					onCreated={(provider) => {
						setWizardOpen(false);
						void load();
						setSelectorFor(provider);
					}}
				/>
			)}

			{selectorFor && (
				<ModelSelector
					provider={selectorFor}
					onClose={() => {
						setSelectorFor(null);
						void load();
					}}
				/>
			)}
		</div>
	);
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
	return (
		<div className="grid place-items-center rounded-xl border border-dashed border-[var(--nx-border)] py-24">
			<div className="text-center">
				<div className="mx-auto grid size-12 place-items-center rounded-xl bg-indigo-500/10">
					<Layers size={20} />
				</div>
				<h3 className="mt-4 font-medium">No providers yet</h3>
				<p className="mt-1 max-w-sm text-sm text-[var(--nx-muted)]">
					Add OpenRouter or any OpenAI-compatible endpoint to start serving models.
				</p>
				<button
					onClick={onAdd}
					className="mt-5 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
				>
					<Plus size={16} />
					Add provider
				</button>
			</div>
		</div>
	);
}
