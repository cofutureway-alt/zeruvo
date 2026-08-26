import { useCallback, useEffect, useState } from 'react';
import { Plus, KeyRound, Layers } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { DashboardShell } from '../../components/DashboardShell';
import { ProviderWizard } from '../../components/admin/ProviderWizard';
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

export default function Providers() {
	const [email, setEmail] = useState('');
	const [providers, setProviders] = useState<ProviderRow[]>([]);
	const [wizardOpen, setWizardOpen] = useState(false);
	const [selectorFor, setSelectorFor] = useState<ProviderRow | null>(null);

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

	useEffect(() => {
		void load();
	}, [load]);

	return (
		<DashboardShell variant="admin" email={email}>
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
						className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
					>
						<Plus size={16} />
						Add provider
					</button>
				</header>

				{providers.length === 0 ? (
					<div className="grid place-items-center rounded-xl border border-dashed border-[var(--nx-border)] py-24">
						<p className="text-sm text-[var(--nx-muted)]">No providers yet — add your first one.</p>
					</div>
				) : (
					<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
						{providers.map((p) => (
							<article key={p.id} className="group rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-5 transition hover:border-indigo-500/40">
								<div className="flex items-start justify-between gap-3">
									<div className="min-w-0">
										<h3 className="truncate font-medium">{p.display_name}</h3>
										<p className="mt-0.5 truncate text-xs text-[var(--nx-muted)]">{p.base_url}</p>
									</div>
									<span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${p.status === 'active' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-700/40 text-zinc-400'}`}>
										{p.status}
									</span>
								</div>
								<div className="mt-4 flex items-center gap-4 text-xs text-[var(--nx-muted)]">
									<span className="flex items-center gap-1.5"><KeyRound size={13} /> {p.keys_total} keys</span>
									<span>{p.models_enabled}/{p.models_total} live</span>
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
		</DashboardShell>
	);
}
