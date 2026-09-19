import { useEffect, useState } from 'react';
import { Gauge, Save } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { DashboardShell } from '../../components/DashboardShell';
import { PageHeader, KpiCard } from '../../components/console-kit';
import { VendorMark, vendorLabel } from '../../design-system/vendor-marks';

interface Defaults {
	rpm: number | null;
	rph: number | null;
	rpd: number | null;
	tpm: number | null;
}

interface OverrideRow {
	model_id: string;
	rpm: number | null;
	rph: number | null;
	rpd: number | null;
	tpm: number | null;
	models: { display_name: string; vendor_slug: string | null } | null;
}

function NumField({ label, value, onChange, hint }: { label: string; value: number | null; onChange: (v: number | null) => void; hint?: string }) {
	return (
		<label className="block">
			<span className="text-xs text-muted-foreground">{label}</span>
			<input
				value={value ?? ''}
				onChange={(e) => onChange(e.target.value.trim() === '' ? null : Number(e.target.value))}
				placeholder="∞"
				inputMode="numeric"
				dir="ltr"
				className="mt-1 w-full rounded-lg border border-border bg-transparent px-3 py-2 font-data text-sm tabular-nums outline-none focus:border-cyan-500"
			/>
			{hint && <span className="mt-1 block text-[11px] text-muted-foreground/70">{hint}</span>}
		</label>
	);
}

/** Global (default) rate limits + a view of per-model overrides. */
export default function RateLimits() {
	const [email, setEmail] = useState('');
	const [defaults, setDefaults] = useState<Defaults>({ rpm: null, rph: null, rpd: null, tpm: null });
	const [overrides, setOverrides] = useState<OverrideRow[]>([]);
	const [busy, setBusy] = useState(false);
	const [saved, setSaved] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		void (async () => {
			const { data: { user } } = await supabase.auth.getUser();
			if (user) setEmail(user.email ?? '');
			const [d, o] = await Promise.all([
				supabase.from('rate_limit_defaults').select('rpm,rph,rpd,tpm').eq('id', 1).maybeSingle(),
				supabase.from('model_rate_limits').select('model_id,rpm,rph,rpd,tpm,models(display_name,vendor_slug)').order('model_id'),
			]);
			if (d.data) setDefaults(d.data as Defaults);
			setOverrides((o.data ?? []) as unknown as OverrideRow[]);
		})();
	}, []);

	async function save() {
		setBusy(true);
		setError(null);
		const pos = (v: number | null) => (v == null || v > 0 ? v : null);
		const { error } = await supabase.from('rate_limit_defaults').upsert({
			id: 1,
			rpm: pos(defaults.rpm),
			rph: pos(defaults.rph),
			rpd: pos(defaults.rpd),
			tpm: pos(defaults.tpm),
		});
		if (error) setError(error.message);
		else {
			setSaved(true);
			setTimeout(() => setSaved(false), 1500);
		}
		setBusy(false);
	}

	return (
		<DashboardShell variant="admin" email={email}>
			<div className="space-y-6">
				<PageHeader
					title="Rate Limits"
					subtitle="Default per-user windows applied to every model without its own override. Limits are per user, per model."
					actions={
						<button onClick={save} disabled={busy} className="flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-40">
							<Save size={14} /> {busy ? 'Saving…' : saved ? 'Saved ✓' : 'Save defaults'}
						</button>
					}
				/>

				{error && <div className="rounded-lg bg-red-500/10 px-4 py-2.5 text-sm text-red-400">{error}</div>}

				<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
					<KpiCard label="Requests / minute" value={defaults.rpm ?? '∞'} icon={<Gauge size={15} />} />
					<KpiCard label="Requests / hour" value={defaults.rph ?? '∞'} icon={<Gauge size={15} />} tone="violet" />
					<KpiCard label="Requests / day" value={defaults.rpd ?? '∞'} icon={<Gauge size={15} />} tone="amber" />
					<KpiCard label="Tokens / minute" value={defaults.tpm ?? '∞'} icon={<Gauge size={15} />} tone="gray" />
				</div>

				<section className="rounded-xl border border-border bg-[var(--nx-surface)] p-5">
					<h2 className="text-sm font-semibold">Default windows</h2>
					<p className="mt-1 text-xs text-muted-foreground">Empty = unlimited. Per-model overrides win over these defaults.</p>
					<div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
						<NumField label="Requests / minute" value={defaults.rpm} onChange={(v) => setDefaults({ ...defaults, rpm: v })} />
						<NumField label="Requests / hour" value={defaults.rph} onChange={(v) => setDefaults({ ...defaults, rph: v })} />
						<NumField label="Requests / day" value={defaults.rpd} onChange={(v) => setDefaults({ ...defaults, rpd: v })} />
						<NumField label="Tokens / minute" value={defaults.tpm} onChange={(v) => setDefaults({ ...defaults, tpm: v })} />
					</div>
				</section>

				<section>
					<h2 className="mb-3 font-data text-xs font-semibold uppercase tracking-[0.18em] text-[var(--nx-muted)]">
						Per-model overrides ({overrides.length})
					</h2>
					{overrides.length === 0 ? (
						<div className="rounded-xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
							No per-model overrides — every model uses the defaults above. Set overrides from a model's Pricing modal.
						</div>
					) : (
						<div className="overflow-x-auto rounded-xl border border-[var(--nx-border)]">
							<table className="w-full min-w-[640px] text-sm">
								<thead className="bg-zinc-900/60 font-data text-[11px] uppercase tracking-wider text-[var(--nx-muted)]">
									<tr>
										<th className="px-4 py-3 text-start">Model</th>
										<th className="px-4 py-3 text-start">RPM</th>
										<th className="px-4 py-3 text-start">RPH</th>
										<th className="px-4 py-3 text-start">RPD</th>
										<th className="px-4 py-3 text-start">TPM</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-[var(--nx-border)]">
									{overrides.map((o) => (
										<tr key={o.model_id} className="transition-colors hover:bg-cyan-500/[0.03]">
											<td className="px-4 py-3">
												<span className="inline-flex items-center gap-2">
													<VendorMark slug={o.models?.vendor_slug} className="size-4 shrink-0" />
													{o.models?.display_name ?? o.model_id.slice(0, 8)}
												</span>
											</td>
											<td className="px-4 py-3 font-data text-xs tabular-nums">{o.rpm ?? <span className="text-muted-foreground">default</span>}</td>
											<td className="px-4 py-3 font-data text-xs tabular-nums">{o.rph ?? <span className="text-muted-foreground">default</span>}</td>
											<td className="px-4 py-3 font-data text-xs tabular-nums">{o.rpd ?? <span className="text-muted-foreground">default</span>}</td>
											<td className="px-4 py-3 font-data text-xs tabular-nums">{o.tpm ?? <span className="text-muted-foreground">default</span>}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</section>
			</div>
		</DashboardShell>
	);
}

void vendorLabel;
