'use client';

import { useEffect, useState } from 'react';
import { Check, ArrowUpRight } from 'lucide-react';

interface PlanPublic {
	id: string;
	name: Record<string, string>;
	description: Record<string, string>;
	daily_weighted_tokens: number | string;
	price_usd: number | string;
	duration_unit: string;
	duration_count: number;
	is_free: boolean;
	default_free: boolean;
}

interface ModelInfo {
	id: string;
	upstream_model_id: string;
	usage_multiplier: number | string;
}

export function PlansBrowser() {
	const [plans, setPlans] = useState<PlanPublic[]>([]);
	const [models, setModels] = useState<ModelInfo[]>([]);
	const [planModels, setPlanModels] = useState<Record<string, string[]>>({});
	const [currentPlanId, setCurrentPlanId] = useState<string | null>(null);
	const [locale, setLocale] = useState('en');

	useEffect(() => {
		setLocale(window.location.pathname.split('/')[1] || 'en');
		void (async () => {
			const { createClient } = await import('@/lib/supabase/client');
			const supabase = createClient();
			const [{ data: plansData }, { data: modelsData }, { data: planModelsData }] =
				await Promise.all([
					supabase.from('plans').select('*').eq('active', true).order('price_usd'),
					supabase
						.from('models')
						.select('id,upstream_model_id,usage_multiplier')
						.eq('enabled_for_users', true),
					supabase.from('plan_models').select('plan_id,model_id'),
				]);

			const grouped: Record<string, string[]> = {};
			for (const pm of planModelsData ?? []) {
				(grouped[pm.plan_id] ??= []).push(pm.model_id);
			}
			setPlans(plansData ?? []);
			setModels(modelsData ?? []);
			setPlanModels(grouped);

			const { data: { user } } = await supabase.auth.getUser();
			if (user) {
				const { data: sub } = await supabase
					.from('subscriptions')
					.select('plan_id')
					.eq('user_id', user.id)
					.eq('status', 'active')
					.gt('expires_at', new Date().toISOString())
					.maybeSingle();
				setCurrentPlanId(sub?.plan_id ?? null);
			}
		})();
	}, []);

	function modelChips(planId: string) {
		const ids = planModels[planId] ?? [];
		return models
			.filter((m) => ids.includes(m.id))
			.slice(0, 4)
			.map((m) => (
				<span key={m.id} className="rounded-md bg-zinc-800/60 px-2 py-0.5 text-[11px]">
					{m.upstream_model_id.length > 24 ? m.upstream_model_id.slice(0, 22) + '…' : m.upstream_model_id}
				</span>
			));
	}

	return (
		<div className="space-y-6">
			<header>
				<h1 className="text-xl font-semibold tracking-tight">Plans</h1>
				<p className="mt-0.5 text-sm text-[var(--nx-muted)]">
					Upgrade for more daily weighted tokens. Checkout with Kashier opens in-place.
				</p>
			</header>

			<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
				{plans.map((p) => {
					const isCurrent = p.id === currentPlanId;
					return (
						<article
							key={p.id}
							className={`relative rounded-xl border bg-[var(--nx-surface)] p-5 ${
								isCurrent ? 'border-indigo-500' : 'border-[var(--nx-border)]'
							}`}
						>
							{p.default_free && (
								<span className="absolute -top-2.5 end-4 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] text-emerald-400">
									Starter free
								</span>
							)}
							<h3 className="font-medium">{p.name[locale] ?? p.name.en}</h3>
							<p className="mt-0.5 min-h-8 text-xs text-[var(--nx-muted)]">
								{p.description[locale] ?? p.description.en ?? ''}
							</p>
							<div className="mt-3 flex items-baseline gap-1">
								<span className="text-3xl font-semibold tabular-nums">
									{p.is_free ? '$0' : `$${Number(p.price_usd).toFixed(0)}`}
								</span>
								<span className="text-xs text-[var(--nx-muted)]">
									/ {p.duration_count} {p.duration_unit}
								</span>
							</div>
							<p className="mt-2 text-sm tabular-nums">
								<span className="font-medium">{Number(p.daily_weighted_tokens).toLocaleString()}</span>{' '}
								<span className="text-xs text-[var(--nx-muted)]">weighted tokens / day</span>
							</p>
							<div className="mt-3 flex flex-wrap gap-1.5">{modelChips(p.id)}</div>
							{ids(p.id, planModels).length > 4 && (
								<p className="mt-1.5 text-[11px] text-[var(--nx-muted)]">
									+{ids(p.id, planModels).length - 4} more
								</p>
							)}
							<button
								disabled={isCurrent}
								onClick={() =>
									alert('Checkout opens here in Phase 5 — Kashier integration.')
								}
								className={`mt-4 flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium transition ${
									isCurrent
										? 'cursor-default border border-indigo-500/50 text-indigo-400'
										: 'bg-indigo-600 text-white hover:bg-indigo-500'
								}`}
							>
								{isCurrent ? (
									<>
										<Check size={15} /> Current plan
									</>
								) : (
									<>
										<ArrowUpRight size={15} />
										{Number(p.price_usd) > 0 ? 'Subscribe' : 'Switch to free'}
									</>
								)}
							</button>
						</article>
					);
				})}
			</div>
		</div>
	);
}

function ids(planId: string, grouped: Record<string, string[]>) {
	return grouped[planId] ?? [];
}
