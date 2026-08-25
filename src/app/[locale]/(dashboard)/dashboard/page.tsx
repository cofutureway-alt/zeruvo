import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';

export default async function DashboardOverview(props: { params: Promise<{ locale: string }> }) {
	const { locale } = await props.params;
	setRequestLocale(locale);
	const t = await getTranslations('dashboard');

	const supabase = await createClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();

	// Live quota snapshot from the atomic engine
	const { data: usage } = await supabase
		.from('daily_usage')
		.select('reserved_weighted, consumed_weighted')
		.eq('user_id', user!.id)
		.eq(
			'utc_date',
			new Date().toISOString().slice(0, 10),
		)
		.maybeSingle();

	const { data: sub } = await supabase
		.from('subscriptions')
		.select('expires_at, status, plans(name, daily_weighted_tokens)')
		.eq('user_id', user!.id)
		.eq('status', 'active')
		.gt('expires_at', new Date().toISOString())
		.maybeSingle();

	return (
		<div className="space-y-6">
			<h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
			<div className="grid gap-4 sm:grid-cols-3">
				<Card title={t('overview')}>
					<p className="text-2xl font-semibold tabular-nums">
						{(usage?.consumed_weighted ?? 0).toLocaleString()}
					</p>
					<p className="text-sm text-[var(--nx-muted)]">
						/ {(sub?.plans as { daily_weighted_tokens?: number })?.daily_weighted_tokens?.toLocaleString() ?? 0}
					</p>
				</Card>
				<Card title="Plan">
					<p className="text-2xl font-semibold">
						{(sub?.plans as { name?: { en?: string } } | null)?.name?.en ?? '—'}
					</p>
					<p className="text-sm text-[var(--nx-muted)]">{sub?.status ?? 'none'}</p>
				</Card>
				<Card title="Expires">
					<p className="text-2xl font-semibold tabular-nums">
						{sub?.expires_at ? new Date(sub.expires_at).toISOString().slice(0, 10) : '—'}
					</p>
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
