import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { UsageChart } from '@/components/dashboard/usage-chart';

export default async function DashboardOverview(props: { params: Promise<{ locale: string }> }) {
	const { locale } = await props.params;
	setRequestLocale(locale);
	const t = await getTranslations('dashboard');

	const supabase = await createClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();

	const today = new Date().toISOString().slice(0, 10);

	const [{ data: usage }, { data: sub }] = await Promise.all([
		supabase
			.from('daily_usage')
			.select('reserved_weighted, consumed_weighted')
			.eq('user_id', user!.id)
			.eq('utc_date', today)
			.maybeSingle(),
		supabase
			.from('subscriptions')
			.select('expires_at, status, plans(name, daily_weighted_tokens)')
			.eq('user_id', user!.id)
			.eq('status', 'active')
			.gt('expires_at', new Date().toISOString())
			.maybeSingle(),
	]);

	const allowance =
		(sub?.plans as { daily_weighted_tokens?: number } | null)?.daily_weighted_tokens ?? 0;
	const consumed = usage?.consumed_weighted ?? 0;
	const pct = allowance > 0 ? Math.min((consumed / allowance) * 100, 100) : 0;

	return (
		<div className="space-y-6">
			<h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>

			{/* quota meter */}
			<div className="rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-5">
				<div className="mb-2 flex items-center justify-between text-sm">
					<span className="font-medium">Today&apos;s quota</span>
					<span className="tabular-nums text-[var(--nx-muted)]">
						{consumed.toLocaleString()} / {allowance.toLocaleString()}
					</span>
				</div>
				<div className="h-2.5 overflow-hidden rounded-full bg-zinc-800">
					<div
						className={`h-full rounded-full transition-all ${
							pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-indigo-500'
						}`}
						style={{ width: `${pct}%` }}
					/>
				</div>
				{pct >= 80 && (
					<p className="mt-2 text-xs text-amber-400">
						You have used {pct.toFixed(0)}% of today&apos;s allowance.
					</p>
				)}
			</div>

			<UsageChart userId={user!.id} allowance={allowance} />

			<div className="grid gap-4 sm:grid-cols-3">
				<Card title={t('plans')}>
					<p className="text-xl font-semibold">
						{(sub?.plans as { name?: { en?: string } } | null)?.name?.en ?? '—'}
					</p>
					<p className="text-sm capitalize text-[var(--nx-muted)]">{sub?.status ?? 'no plan'}</p>
				</Card>
				<Card title="Renews / expires">
					<p className="text-xl font-semibold tabular-nums">
						{sub?.expires_at ? new Date(sub.expires_at).toISOString().slice(0, 10) : '—'}
					</p>
				</Card>
				<Card title="Reserved (in-flight)">
					<p className="text-xl font-semibold tabular-nums">
						{(usage?.reserved_weighted ?? 0).toLocaleString()}
					</p>
					<p className="text-sm text-[var(--nx-muted)]">pending requests hold this much</p>
				</Card>
			</div>
		</div>
	);
}

function Card(props: { title: string; children: React.ReactNode }) {
	return (
		<div className="rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-5">
			<p className="mb-2 text-sm text-[var(--nx-muted)]">{props.title}</p>
			{props.children}
		</div>
	);
}
