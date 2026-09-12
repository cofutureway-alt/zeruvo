import { useMemo, useState, useEffect } from 'react';
import { Check, ArrowUpRight, X, Loader2, ShieldCheck, Ticket, Tag, RotateCw, Boxes, Search, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { SkeletonPlans } from '../../components/skeleton';
import { Reveal } from '../../design-system/reveal';
import { Card, CardContent } from '../../design-system/card';
import { Button } from '../../design-system/button';
import { ProviderMark } from '../../design-system/brand-marks';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../design-system/dialog';
import { Input } from '../../design-system/input';
import { ScrollArea } from '../../design-system/scroll-area';

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
	renewable: boolean;
	popular: boolean;
}

interface CatalogModel {
	id: string;
	upstream_model_id: string;
	display_name: string;
	usage_multiplier: number | string;
	category_name: string;
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
	const [models, setModels] = useState<CatalogModel[]>([]);
	const [planModels, setPlanModels] = useState<Record<string, string[]>>({});
	const [currentPlanId, setCurrentPlanId] = useState<string | null>(null);
	const [checkoutFor, setCheckoutFor] = useState<{ id: string; name: string; priceUsd: number; renew: boolean } | null>(null);
	const [egpRate, setEgpRate] = useState(50);
	const [dialogPlan, setDialogPlan] = useState<PlanPublic | null>(null);
	const [modelsOpen, setModelsOpen] = useState(false);

	useEffect(() => {
		void (async () => {
			const { data: { user } } = await supabase.auth.getUser();
			let currentPlanId: string | null = null;
			if (user) {
				const { data: sub } = await supabase
					.from('subscriptions')
					.select('plan_id')
					.eq('user_id', user.id)
					.eq('status', 'active')
					.gt('expires_at', new Date().toISOString())
					.maybeSingle();
				currentPlanId = sub?.plan_id ?? null;
			}
			setCurrentPlanId(currentPlanId);

			// Include the user's current plan even if it's hidden from the
			// catalog (soft-deleted), so they can see it and renew it.
			let plansQuery = supabase.from('plans').select('*').order('price_usd');
			plansQuery = currentPlanId
				? plansQuery.or(`active.eq.true,id.eq.${currentPlanId}`)
				: plansQuery.eq('active', true);

			const [{ data: plansData }, { data: modelsData }, { data: pmData }, { data: gwData }] = await Promise.all([
				plansQuery,
				supabase.from('models')
					.select('id,upstream_model_id,display_name,usage_multiplier,model_categories(name)')
					.eq('enabled_for_users', true),
				supabase.from('plan_models').select('plan_id,model_id'),
				supabase.from('payment_gateways').select('egp_rate').eq('gateway', 'kashier').maybeSingle(),
			]);
			const catalogModels: CatalogModel[] = (modelsData ?? []).map((m: Record<string, unknown>) => ({
				id: String(m.id),
				upstream_model_id: String(m.upstream_model_id),
				display_name: String(m.display_name),
				usage_multiplier: Number(m.usage_multiplier ?? 1),
				category_name: String((m.model_categories as { name?: string } | null)?.name ?? 'AI Models'),
			}));
			const grouped: Record<string, string[]> = {};
			for (const pm of pmData ?? []) (grouped[pm.plan_id] ??= []).push(pm.model_id);
			setPlans(plansData ?? []);
			setModels(catalogModels);
			setPlanModels(grouped);
			if (gwData?.egp_rate) setEgpRate(Number(gwData.egp_rate));
			setLoading(false);
		})();
	}, []);

	return (
		<>
			{loading ? (
				<SkeletonPlans count={3} />
			) : (
				<div className="mt-8 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
					{plans.map((p, index) => {
						const isCurrent = p.id === currentPlanId;
						const ids = planModels[p.id] ?? [];
						const canRenew = isCurrent && p.renewable && Number(p.price_usd) > 0;
						return (
							<Reveal key={p.id} delay={Math.min(index, 6) * 80} className="h-full">
								<Card
									className={`hover-lift relative flex h-full flex-col border bg-card ${
										p.popular
											? 'border-primary shadow-lg shadow-primary/10'
											: isCurrent
												? 'border-primary/60'
												: 'border-border hover:border-primary/50'
									}`}
								>
									{p.popular ? (
										<span className="absolute -top-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
											<Sparkles className="h-3 w-3" aria-hidden="true" /> Most popular
										</span>
									) : p.default_free ? (
										<span className="absolute -top-3 right-4 rounded bg-primary/15 px-2 py-1 text-xs text-primary">
											Starter free
										</span>
									) : null}
									<CardContent className="flex flex-1 flex-col p-6">
										<h3 className="font-display text-xl font-semibold">{p.name[locale] ?? p.name.en}</h3>
										<p className="mt-1 text-sm text-muted-foreground">{p.description[locale] ?? p.description.en ?? ''}</p>

										<div className="mt-5 flex items-baseline gap-2">
											<span className="font-display text-4xl font-semibold tabular-nums">
												{p.is_free ? '$0' : `$${Number(p.price_usd).toFixed(0)}`}
											</span>
											<span className="text-sm text-muted-foreground">/ {p.duration_count} {p.duration_unit}</span>
										</div>
										<p className="mt-2 text-sm">
											<span className="font-medium text-primary">{Number(p.daily_weighted_tokens).toLocaleString()}</span>{' '}
											<span className="text-muted-foreground">weighted tokens / day</span>
										</p>

										<button
											type="button"
											onClick={() => {
												setDialogPlan(p);
												setModelsOpen(true);
											}}
											className="group mt-5 flex w-full items-center justify-between rounded-md border border-border bg-accent/50 px-3 py-2.5 text-left text-sm transition-all duration-200 hover:border-primary/50 hover:bg-accent"
										>
											<span className="flex items-center gap-2">
												<Boxes className="h-4 w-4 text-primary" aria-hidden="true" />
												<span>
													<span className="font-medium">{ids.length} models</span>{' '}
													<span className="text-muted-foreground">included</span>
												</span>
											</span>
											<span className="text-xs text-primary transition-transform duration-200 group-hover:translate-x-0.5">
												{locale === 'ar' ? 'استعراض الكل ←' : 'View all →'}
											</span>
										</button>

										<Button
											disabled={isCurrent && !canRenew}
											variant={isCurrent && !canRenew ? 'outline' : 'default'}
											onClick={() =>
												setCheckoutFor({
													id: p.id,
													name: p.name[locale] ?? p.name.en,
													priceUsd: Number(p.price_usd),
													renew: isCurrent,
												})
											}
											className="mt-4 w-full gap-2 transition-transform duration-300 hover:-translate-y-0.5"
										>
											{isCurrent && !canRenew ? (
												<>
													<Check className="h-4 w-4" aria-hidden="true" /> Current plan
												</>
											) : canRenew ? (
												<>
													<RotateCw className="h-4 w-4" aria-hidden="true" /> Renew
												</>
											) : (
												<>
													<ArrowUpRight className="h-4 w-4" aria-hidden="true" />
													{Number(p.price_usd) > 0 ? 'Subscribe' : 'Switch to free'}
												</>
											)}
										</Button>
									</CardContent>
								</Card>
							</Reveal>
						);
					})}
				</div>
			)}

			<PlanModelsDialog
				plan={dialogPlan}
				models={models}
				planModelIds={dialogPlan ? (planModels[dialogPlan.id] ?? []) : []}
				open={modelsOpen}
				onOpenChange={setModelsOpen}
			/>

			{checkoutFor && (
				<CheckoutModal
					planId={checkoutFor.id}
					planName={checkoutFor.name}
					priceUsd={checkoutFor.priceUsd}
					egpRate={egpRate}
					renew={checkoutFor.renew}
					onClose={() => {
						setCheckoutFor(null);
						window.location.reload();
					}}
				/>
			)}
		</>
	);
}

/**
 * Design's "plan models" dialog: search + group by category, with the
 * weighted multiplier badge. Upstream provider names are not exposed —
 * grouping uses the public model categories.
 */
function PlanModelsDialog(props: {
	plan: PlanPublic | null;
	models: CatalogModel[];
	planModelIds: string[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const { i18n } = useTranslation();
	const locale = i18n.language;
	const [query, setQuery] = useState('');

	const list = useMemo(
		() => props.models.filter((m) => props.planModelIds.includes(m.id)),
		[props.models, props.planModelIds],
	);
	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return list;
		return list.filter(
			(m) =>
				m.display_name.toLowerCase().includes(q) ||
				m.upstream_model_id.toLowerCase().includes(q) ||
				m.category_name.toLowerCase().includes(q),
		);
	}, [list, query]);

	const groups = useMemo(() => {
		const map = new Map<string, CatalogModel[]>();
		for (const m of filtered) {
			const g = map.get(m.category_name) ?? [];
			g.push(m);
			map.set(m.category_name, g);
		}
		return [...map.entries()];
	}, [filtered]);

	return (
		<Dialog open={props.open} onOpenChange={props.onOpenChange}>
			<DialogContent className="max-w-lg gap-0 p-0">
				<DialogHeader className="border-b border-border p-5">
					<DialogTitle className="flex items-center gap-2 font-display">
						<Boxes className="h-4 w-4 text-primary" aria-hidden="true" />
						{props.plan ? `${props.plan.name[locale] ?? props.plan.name.en} plan models` : ''}
					</DialogTitle>
					<DialogDescription>
						{list.length} models available · up to ×{Math.max(...list.map((m) => Number(m.usage_multiplier)), 0)} token weight
					</DialogDescription>
					<div className="relative pt-2">
						<Search className="absolute left-3 top-1/2 mt-1 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
						<Input
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							placeholder={locale === 'ar' ? 'ابحث في الموديلات…' : 'Search models…'}
							className="pl-9"
						/>
					</div>
				</DialogHeader>
				<ScrollArea className="max-h-[60vh]">
					<div className="p-5 pt-3">
						{groups.length === 0 ? (
							<p className="py-8 text-center text-sm text-muted-foreground">
								{locale === 'ar' ? 'لا موديلات تطابق البحث.' : 'No models match your search.'}
							</p>
						) : (
							groups.map(([category, items]) => (
								<div key={category} className="mt-4 first:mt-1">
									<p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
										{category} · {items.length}
									</p>
									<div className="space-y-1">
										{items.map((m) => (
											<div
												key={m.id}
												className="flex items-center gap-3 rounded-md border border-transparent px-2 py-2 transition-colors hover:border-border hover:bg-accent"
											>
												<ProviderMark name={m.category_name} className="h-5 w-5 shrink-0 text-foreground" />
												<div className="min-w-0 flex-1">
													<p className="truncate text-sm font-medium">{m.display_name}</p>
													<p className="truncate font-mono text-xs text-muted-foreground">{m.upstream_model_id}</p>
												</div>
												<span className="rounded bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
													×{Number(m.usage_multiplier)}
												</span>
											</div>
										))}
									</div>
								</div>
							))
						)}
					</div>
				</ScrollArea>
			</DialogContent>
		</Dialog>
	);
}

type Step = 'coupon' | 'paying';

function CheckoutModal(props: { planId: string; planName: string; priceUsd: number; egpRate: number; renew: boolean; onClose: () => void }) {
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
				body: JSON.stringify({ plan_id: props.planId, coupon_code: appliedCode, renew: props.renew }),
			});
			const json = await res.json().catch(() => null);
			if (!res.ok) setPayError(json?.error ?? 'Checkout failed');
			else setIframeUrl(json.checkout_url);
		})();
	}

	return (
		<div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm">
			<div className="flex h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
				<header className="flex items-center justify-between border-b border-border px-5 py-3.5">
					<div>
						<p className="text-sm font-medium">{props.renew ? 'Renew' : 'Subscribe'} — {props.planName}</p>
						<p className="flex items-center gap-1 text-[11px] text-muted-foreground">
							<ShieldCheck size={11} />
							Secured by Kashier · 1 USD ≈ {props.egpRate} EGP
						</p>
					</div>
					<button onClick={props.onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-zinc-800/60">
						<X size={18} />
					</button>
				</header>

				{step === 'coupon' ? (
					<div className="space-y-5 p-6">
						{/* summary */}
						<div className="rounded-xl border border-border bg-accent/40 p-4 text-sm">
							<Row label="Plan price" value={`$${props.priceUsd.toFixed(2)} → ${Math.round(props.priceUsd * props.egpRate).toLocaleString()} EGP`} />
							{discountPct > 0 && (
								<Row label={`Discount (${discountPct}%)`} value={`−$${discountUsd.toFixed(2)}`} accent />
							)}
							<div className="my-2 border-t border-border" />
							<Row label="You pay" value={`${finalEgp.toLocaleString()} EGP`} bold />
						</div>

						{/* coupon input */}
						<div>
							<label className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
								<Ticket size={12} />
								Coupon code
							</label>
							<div className="mt-2 flex gap-2">
								<input
									value={couponCode}
									onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
									onKeyDown={(e) => e.key === 'Enter' && applyCoupon()}
									placeholder="e.g. LAUNCH20"
									className="min-w-0 flex-1 rounded-lg border border-border bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-primary"
								/>
								<button
									onClick={applyCoupon}
									disabled={checkingCoupon || !couponCode.trim()}
									className="flex shrink-0 items-center gap-1.5 rounded-lg border border-primary/50 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-40"
								>
									{checkingCoupon ? <Loader2 size={14} className="animate-spin" /> : <Tag size={14} />}
									Apply
								</button>
							</div>
							{couponMsg && (
								<p className={`mt-2 text-xs ${couponMsg.ok ? 'text-success' : 'text-red-400'}`}>{couponMsg.text}</p>
							)}
						</div>

						<button
							onClick={proceedToPay}
							className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90"
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
						<Loader2 className="animate-spin text-primary" size={28} />
					</div>
				)}
			</div>
		</div>
	);
}

function Row(props: { label: string; value: string; bold?: boolean; accent?: boolean }) {
	return (
		<div className="flex items-center justify-between">
			<span className={props.accent ? 'text-success' : 'text-muted-foreground'}>{props.label}</span>
			<span className={`tabular-nums ${props.bold ? 'font-semibold' : ''} ${props.accent ? 'text-success' : ''}`}>
				{props.value}
			</span>
		</div>
	);
}
