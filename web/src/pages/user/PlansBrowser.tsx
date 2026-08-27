import { useEffect, useState } from 'react';
import { Check, ArrowUpRight, X, Loader2, ShieldCheck, Ticket, Tag } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { SkeletonPlans } from '../../components/skeleton';

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
 * dashboard. Checkout opens an in-place modal: coupon step first,
 * then the signed Kashier iframe on the discounted total.
 */
export default function PlansBrowser() {
	const { i18n } = useTranslation();
	const locale = i18n.language;
	const [plans, setPlans] = useState<PlanPublic[]>([]);
	const [loading, setLoading] = useState(true);
	const [models, setModels] = useState<Array<{ id: string; upstream_model_id: string }>>([]);
	const [planModels, setPlanModels] = useState<Record<string, string[]>>({});
	const [currentPlanId, setCurrentPlanId] = useState<string | null>(null);
	const [checkoutFor, setCheckoutFor] = useState<{ id: string; name: string; priceUsd: number } | null>(null);
	const [egpRate, setEgpRate] = useState(50);

	useEffect(() => {
		void (async () => {
			const [{ data: plansData }, { data: modelsData }, { data: pmData }, { data: gwData }] = await Promise.all([
				supabase.from('plans').select('*').eq('active', true).order('price_usd'),
				supabase.from('models').select('id,upstream_model_id').eq('enabled_for_users', true),
				supabase.from('plan_models').select('plan_id,model_id'),
				supabase.from('payment_gateways').select('egp_rate').eq('gateway', 'kashier').maybeSingle(),
			]);
			const grouped: Record<string, string[]> = {};
			for (const pm of pmData ?? []) (grouped[pm.plan_id] ??= []).push(pm.model_id);
			setPlans(plansData ?? []);
			setModels(modelsData ?? []);
			setPlanModels(grouped);
			if (gwData?.egp_rate) setEgpRate(Number(gwData.egp_rate));

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
			setLoading(false);
		})();
	}, []);

	return (
		<>
			{loading ? <SkeletonPlans count={3} /> : (
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
								onClick={() => setCheckoutFor({ id: p.id, name: p.name[locale] ?? p.name.en, priceUsd: Number(p.price_usd) })}
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
		)}

			{checkoutFor && (
				<CheckoutModal
					planId={checkoutFor.id}
					planName={checkoutFor.name}
					priceUsd={checkoutFor.priceUsd}
					egpRate={egpRate}
					onClose={() => {
						setCheckoutFor(null);
						window.location.reload();
					}}
				/>
			)}
		</>
	);
}

type Step = 'coupon' | 'paying';

function CheckoutModal(props: { planId: string; planName: string; priceUsd: number; egpRate: number; onClose: () => void }) {
	const [step, setStep] = useState<Step>('coupon');
	const [couponCode, setCouponCode] = useState('');
	const [discountPct, setDiscountPct] = useState(0);
	const [appliedCode, setAppliedCode] = useState<string | null>(null);
	const [couponMsg, setCouponMsg] = useState<{ ok: boolean; text: string } | null>(null);
	const [checkingCoupon, setCheckingCoupon] = useState(false);

	const [iframeUrl, setIframeUrl] = useState<string | null>(null);
	const [payError, setPayError] = useState<string | null>(null);

	const discountUsd = (props.priceUsd * discountPct) / 100;
	const finalUsd = Math.max(props.priceUsd - discountUsd, 0);
	const finalEgp = Math.round(finalUsd * props.egpRate * 100) / 100;

	function applyCoupon() {
		const code = couponCode.trim().toUpperCase();
		if (!code) return;
		setCheckingCoupon(true);
		setCouponMsg(null);

		void (async () => {
			const { data } = await supabase
				.from('coupons')
				.select('code,percent_off,valid_from,valid_to,max_redemptions,times_redeemed,active')
				.eq('code', code)
				.eq('active', true)
				.maybeSingle();

			if (!data) {
				setCouponMsg({ ok: false, text: 'Invalid or unknown coupon code.' });
				setDiscountPct(0);
				setAppliedCode(null);
				setCheckingCoupon(false);
				return;
			}
			const now = new Date();
			if (new Date(data.valid_from) > now || new Date(data.valid_to) <= now) {
				setCouponMsg({ ok: false, text: 'This coupon is expired or not yet active.' });
				setCheckingCoupon(false);
				return;
			}
			if (data.times_redeemed >= data.max_redemptions) {
				setCouponMsg({ ok: false, text: 'This coupon has reached its usage limit.' });
				setCheckingCoupon(false);
				return;
			}

			setDiscountPct(Number(data.percent_off));
			setAppliedCode(data.code);
			setCouponMsg({ ok: true, text: `${data.code} applied — ${Number(data.percent_off)}% off.` });
			setCheckingCoupon(false);
		})();
	}

	function proceedToPay() {
		setStep('paying');
		void (async () => {
			const functionsUrl = import.meta.env.VITE_SUPABASE_URL.replace('.supabase.co', '.functions.supabase.co');
			const { data: { session } } = await supabase.auth.getSession();
			const res = await fetch(`${functionsUrl}/checkout`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${session?.access_token ?? ''}`,
					apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
				},
				body: JSON.stringify({ plan_id: props.planId, coupon_code: appliedCode }),
			});
			const json = await res.json().catch(() => null);
			if (!res.ok) setPayError(json?.error ?? 'Checkout failed');
			else setIframeUrl(json.checkout_url);
		})();
	}

	return (
		<div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm">
			<div className="flex h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--nx-border)] bg-[var(--nx-surface)] shadow-2xl">
				<header className="flex items-center justify-between border-b border-[var(--nx-border)] px-5 py-3.5">
					<div>
						<p className="text-sm font-medium">Subscribe — {props.planName}</p>
						<p className="flex items-center gap-1 text-[11px] text-[var(--nx-muted)]">
							<ShieldCheck size={11} />
							Secured by Kashier · 1 USD ≈ {props.egpRate} EGP
						</p>
					</div>
					<button onClick={props.onClose} className="rounded-lg p-1.5 text-[var(--nx-muted)] hover:bg-zinc-800/60">
						<X size={18} />
					</button>
				</header>

				{step === 'coupon' ? (
					<div className="space-y-5 p-6">
						{/* summary */}
						<div className="rounded-xl border border-[var(--nx-border)] bg-[var(--nx-bg-raised)] p-4 text-sm">
							<Row label="Plan price" value={`$${props.priceUsd.toFixed(2)} → ${Math.round(props.priceUsd * props.egpRate).toLocaleString()} EGP`} />
							{discountPct > 0 && (
								<Row label={`Discount (${discountPct}%)`} value={`−$${discountUsd.toFixed(2)}`} accent />
							)}
							<div className="my-2 border-t border-[var(--nx-border)]" />
							<Row label="You pay" value={`${finalEgp.toLocaleString()} EGP`} bold />
						</div>

						{/* coupon input */}
						<div>
							<label className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-[var(--nx-muted)]">
								<Ticket size={12} />
								Coupon code
							</label>
							<div className="mt-2 flex gap-2">
								<input
									value={couponCode}
									onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
									onKeyDown={(e) => e.key === 'Enter' && applyCoupon()}
									placeholder="e.g. LAUNCH20"
									className="min-w-0 flex-1 rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-indigo-500"
								/>
								<button
									onClick={applyCoupon}
									disabled={checkingCoupon || !couponCode.trim()}
									className="flex shrink-0 items-center gap-1.5 rounded-lg border border-indigo-500/50 px-4 py-2 text-sm font-medium text-indigo-300 hover:bg-indigo-500/10 disabled:opacity-40"
								>
									{checkingCoupon ? <Loader2 size={14} className="animate-spin" /> : <Tag size={14} />}
									Apply
								</button>
							</div>
							{couponMsg && (
								<p className={`mt-2 text-xs ${couponMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{couponMsg.text}</p>
							)}
						</div>

						<button
							onClick={proceedToPay}
							className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white shadow-[0_0_24px_rgba(139,124,255,0.25)] transition hover:bg-indigo-500"
						>
							Continue to payment — {finalEgp.toLocaleString()} EGP
						</button>
					</div>
				) : payError ? (
					<div className="grid place-items-center p-10 text-center">
						<p className="text-sm text-red-400">{payError}</p>
					</div>
				) : iframeUrl ? (
					<iframe src={iframeUrl} title="Kashier secure checkout" className="min-h-0 flex-1 w-full border-0" allow="payment" />
				) : (
					<div className="grid place-items-center py-16">
						<Loader2 className="animate-spin text-indigo-400" size={28} />
					</div>
				)}
			</div>
		</div>
	);
}

function Row(props: { label: string; value: string; bold?: boolean; accent?: boolean }) {
	return (
		<div className="flex items-center justify-between">
			<span className={props.accent ? 'text-emerald-400' : 'text-[var(--nx-muted)]'}>{props.label}</span>
			<span className={`tabular-nums ${props.bold ? 'font-semibold' : ''} ${props.accent ? 'text-emerald-400' : ''}`}>
				{props.value}
			</span>
		</div>
	);
}
