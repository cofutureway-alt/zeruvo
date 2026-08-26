import { useEffect, useState } from 'react';
import { Check, ArrowUpRight, X, Loader2, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';

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

/**
 * Plans grid shared by the marketing /pricing page and the user
 * dashboard. Checkout opens the signed Kashier iframe in-place.
 */
export default function PlansBrowser() {
	const { i18n } = useTranslation();
	const locale = i18n.language;
	const [plans, setPlans] = useState<PlanPublic[]>([]);
	const [models, setModels] = useState<Array<{ id: string; upstream_model_id: string }>>([]);
	const [planModels, setPlanModels] = useState<Record<string, string[]>>({});
	const [currentPlanId, setCurrentPlanId] = useState<string | null>(null);
	const [checkoutFor, setCheckoutFor] = useState<{ id: string; name: string } | null>(null);

	useEffect(() => {
		void (async () => {
			const [{ data: plansData }, { data: modelsData }, { data: pmData }] = await Promise.all([
				supabase.from('plans').select('*').eq('active', true).order('price_usd'),
				supabase.from('models').select('id,upstream_model_id').eq('enabled_for_users', true),
				supabase.from('plan_models').select('plan_id,model_id'),
			]);
			const grouped: Record<string, string[]> = {};
			for (const pm of pmData ?? []) (grouped[pm.plan_id] ??= []).push(pm.model_id);
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

	return (
		<>
			<div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
				{plans.map((p) => {
					const isCurrent = p.id === currentPlanId;
					const ids = planModels[p.id] ?? [];
					return (
						<article
							key={p.id}
							className={`relative rounded-xl border bg-[var(--nx-surface)] p-5 ${isCurrent ? 'border-indigo-500' : 'border-[var(--nx-border)]'}`}
						>
							{p.default_free && (
								<span className="absolute -top-2.5 end-4 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] text-emerald-400">
									Starter free
								</span>
							)}
							<h3 className="font-medium">{p.name[locale] ?? p.name.en}</h3>
							<p className="mt-0.5 min-h-8 text-xs text-[var(--nx-muted)]">{p.description[locale] ?? p.description.en ?? ''}</p>
							<div className="mt-3 flex items-baseline gap-1">
								<span className="text-3xl font-semibold tabular-nums">{p.is_free ? '$0' : `$${Number(p.price_usd).toFixed(0)}`}</span>
								<span className="text-xs text-[var(--nx-muted)]">/ {p.duration_count} {p.duration_unit}</span>
							</div>
							<p className="mt-2 text-sm tabular-nums">
								<span className="font-medium">{Number(p.daily_weighted_tokens).toLocaleString()}</span>{' '}
								<span className="text-xs text-[var(--nx-muted)]">weighted tokens / day</span>
							</p>
							<div className="mt-3 flex flex-wrap gap-1.5">
								{models
									.filter((m) => ids.includes(m.id))
									.slice(0, 4)
									.map((m) => (
										<span key={m.id} className="rounded-md bg-zinc-800/60 px-2 py-0.5 text-[11px]">
											{m.upstream_model_id.length > 24 ? m.upstream_model_id.slice(0, 22) + '…' : m.upstream_model_id}
										</span>
									))}
							</div>
							{ids.length > 4 && <p className="mt-1.5 text-[11px] text-[var(--nx-muted)]">+{ids.length - 4} more</p>}
							<button
								disabled={isCurrent}
								onClick={() => setCheckoutFor({ id: p.id, name: p.name[locale] ?? p.name.en })}
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

			{checkoutFor && (
				<CheckoutModal
					planId={checkoutFor.id}
					planName={checkoutFor.name}
					onClose={() => {
						setCheckoutFor(null);
						window.location.reload();
					}}
				/>
			)}
		</>
	);
}

function CheckoutModal(props: { planId: string; planName: string; onClose: () => void }) {
	const [iframeUrl, setIframeUrl] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		void (async () => {
			// checkout runs as a Supabase Edge Function (server-side Kashier signing)
			const functionsUrl = import.meta.env.VITE_SUPABASE_URL.replace('.supabase.co', '.functions.supabase.co');
			const { data: { session } } = await supabase.auth.getSession();
			const res = await fetch(`${functionsUrl}/checkout`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${session?.access_token ?? ''}`,
					apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
				},
				body: JSON.stringify({ plan_id: props.planId }),
			});
			const json = await res.json().catch(() => null);
			if (!res.ok) setError(json?.error ?? 'Checkout failed');
			else setIframeUrl(json.checkout_url);
		})();
	}, [props.planId]);

	return (
		<div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm">
			<div className="flex h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--nx-border)] bg-[var(--nx-surface)] shadow-2xl">
				<header className="flex items-center justify-between border-b border-[var(--nx-border)] px-5 py-3.5">
					<div>
						<p className="text-sm font-medium">Subscribe — {props.planName}</p>
						<p className="flex items-center gap-1 text-[11px] text-[var(--nx-muted)]">
							<ShieldCheck size={11} />
							Secured by Kashier · paid in EGP
						</p>
					</div>
					<button onClick={props.onClose} className="rounded-lg p-1.5 text-[var(--nx-muted)] hover:bg-zinc-800/60">
						<X size={18} />
					</button>
				</header>

				{error ? (
					<div className="grid flex-1 place-items-center p-8 text-center">
						<p className="text-sm text-red-400">{error}</p>
					</div>
				) : iframeUrl ? (
					<iframe src={iframeUrl} title="Kashier secure checkout" className="h-full w-full flex-1 border-0" allow="payment" />
				) : (
					<div className="grid flex-1 place-items-center">
						<Loader2 className="animate-spin text-indigo-400" size={28} />
					</div>
				)}
			</div>
		</div>
	);
}
