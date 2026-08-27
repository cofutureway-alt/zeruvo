import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { DashboardShell } from '../../components/DashboardShell';
import { ModelUsageTable } from '../../components/ModelUsageTable';
import { TimeRangeFilter } from '../../components/TimeRangeFilter';
import { useModelUsage, type TimeRange } from '../../hooks/useModelUsage';

export default function Admin() {
	const [email, setEmail] = useState('');
	const [range, setRange] = useState<TimeRange>('30d');
	const { data: usage, loading, total } = useModelUsage(range);

	useEffect(() => {
		void supabase.auth.getUser().then(({ data: { user } }) => setEmail(user?.email ?? ''));
	}, []);

	return (
		<DashboardShell variant="admin" email={email}>
			<div className="space-y-6">
				<header>
					<h1 className="text-2xl font-semibold tracking-tight">Admin Console</h1>
					<p className="mt-0.5 max-w-xl text-sm text-[var(--nx-muted)]">
						Manage providers, model catalogs, plans, users, payments, coupons, announcements and
						payment gateways from the sidebar.
					</p>
				</header>

				{/* Model analytics */}
				<section className="space-y-4">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div>
							<h2 className="font-display text-lg font-semibold">Model analytics</h2>
							<p className="text-sm text-[var(--nx-muted)]">Usage breakdown across all users by model.</p>
						</div>
						<TimeRangeFilter value={range} onChange={setRange} />
					</div>

					<div className="grid gap-4 sm:grid-cols-3">
						<StatCard title="Total requests" value={total.requests.toLocaleString()} />
						<StatCard title="Total tokens (in)" value={total.tokens_in.toLocaleString()} />
						<StatCard title="Total weighted tokens" value={total.weighted_tokens.toLocaleString()} />
					</div>

					<ModelUsageTable data={usage} loading={loading} showProvider total={total} />
				</section>
			</div>
		</DashboardShell>
	);
}

function StatCard({ title, value }: { title: string; value: string }) {
	return (
		<div className="rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-5">
			<p className="mb-2 text-xs uppercase tracking-wide text-[var(--nx-muted)]">{title}</p>
			<p className="text-xl font-semibold tabular-nums">{value}</p>
		</div>
	);
}
