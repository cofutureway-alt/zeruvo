import { Link } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import {
	ArrowRight, Check, Code, Gauge, Gift, Layers, Route as RouteIcon,
	Shield, Terminal, Zap, Search,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../auth-context';
import { NewSiteHeader, NewSiteFooter } from '../../design-system/new-chrome';
import { Reveal } from '../../design-system/reveal';
import { CountUp } from '../../design-system/count-up';
import { Marquee } from '../../design-system/marquee';
import { ProviderMark } from '../../design-system/brand-marks';
import { ModelCard, type ModelCardData } from '../../components/ModelCard';
import { OrbitField } from '../../design-system/orbit-field';
import { NetworkField } from '../../design-system/network-field';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../design-system/card';

/**
 * New-design marketing home. Live data from Supabase:
 *  - enabled models (count + catalog preview)
 *  - active providers (marquee)
 *  - stats strip (real catalog counts, no mock numbers)
 */

const features = [
	{
		icon: RouteIcon,
		key: 'endpoint',
		fallback: ['One endpoint, every model', 'Swap the base URL and keep your existing SDK. Zeruvo speaks OpenAI, Anthropic and Gemini protocols natively.'],
	},
	{
		icon: Zap,
		key: 'failover',
		fallback: ['Automatic failover', 'Requests reroute across healthy upstream providers in milliseconds, so a single outage never reaches your users.'],
	},
	{
		icon: Gauge,
		key: 'billing',
		fallback: ['Weighted-token billing', 'Every model carries a transparent multiplier. You always know exactly what a request costs before you send it.'],
	},
	{
		icon: Shield,
		key: 'keys',
		fallback: ['Keys you control', 'Gateway keys are stored as one-way hashes, scoped per app, and revocable instantly from your console.'],
	},
	{
		icon: Layers,
		key: 'analytics',
		fallback: ['Live analytics', 'Per-model requests, tokens in and out, weighted usage and latency, charted across any period you pick.'],
	},
	{
		icon: Code,
		key: 'streaming',
		fallback: ['Streaming by default', 'Server-sent events on every protocol, with consistent chunk shapes no matter which upstream answers.'],
	},
];

/* Public brand marquee — famous AI companies, never our upstream providers. */
const BRAND_NAMES = ['OpenAI', 'Anthropic', 'Google', 'DeepSeek', 'Moonshot AI', 'Qwen', 'Mistral', 'xAI', 'Perplexity', 'Meta'];

export default function Home() {
	const { t, i18n } = useTranslation();
	const { user } = useAuth();
	const [models, setModels] = useState<ModelCardData[]>([]);

	useEffect(() => {
		void (async () => {
			// same view the /models catalog uses — full pricing + vendor info
			const { data } = await supabase
				.from('models_public_view')
				.select('id,slug,display_name,vendor_slug,vendor_name,context_window,payg_enabled,usage_multiplier,enabled_for_users,is_priced,is_featured,is_custom,input_modalities,output_modalities,supports_reasoning,input_price,output_price,cache_read_price,discount_percent,quality_score,tags')
				.eq('is_priced', true)
				.order('display_name')
				.limit(8);
			setModels((data ?? []) as unknown as ModelCardData[]);
		})();
	}, []);

	const totalModels = models.length;
	const catalogPreview = useMemo(() => models.slice(0, 8), [models]);
	const dashboardTo = user ? '/dashboard' : '/signup';

	// logged-in users with an available free-credit offer see the claim banner
	const [hasOffer, setHasOffer] = useState(false);
	useEffect(() => {
		if (!user) { setHasOffer(false); return; }
		void (async () => {
			const { data } = await supabase.rpc('list_credit_offers');
			const rows = (data ?? []) as Array<{ eligible: boolean; needs_topup: boolean }>;
			setHasOffer(rows.some((o) => o.eligible || o.needs_topup));
		})();
	}, [user]);

	return (
		<div className="flex min-h-screen flex-col bg-background text-foreground">
			<NewSiteHeader />
			<main className="flex-1">
				{/* ============ HERO ============ */}
				<section className="relative overflow-hidden px-4 pb-20 pt-16 sm:px-6 lg:px-8 lg:pt-24">
					<OrbitField />
					<div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-2 lg:items-center">
						<div className="max-w-2xl">
							<p className="animate-fade-up inline-flex items-center gap-2 font-display text-sm font-medium uppercase tracking-wider text-primary">
								<span className="relative flex h-2 w-2">
									<span className="animate-pulse-ring absolute inline-flex h-full w-full rounded-full bg-primary" />
									<span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
								</span>
								{i18n.language === 'ar' ? 'بوابة ذكاء موحدة' : 'Unified AI Gateway'}
							</p>
							<h1
								style={{ animationDelay: '120ms' }}
								className="animate-fade-up mt-4 font-display text-4xl font-semibold leading-tight tracking-tight sm:text-5xl lg:text-6xl"
							>
								{i18n.language === 'ar' ? 'كل موديلات الحدود' : 'Every frontier model'}{' '}
								<span className="text-primary">{i18n.language === 'ar' ? 'بمفتاح API واحد' : 'behind one API key'}</span>
							</h1>
							<p
								style={{ animationDelay: '240ms' }}
								className="animate-fade-up mt-6 text-lg leading-relaxed text-muted-foreground"
							>
								{i18n.language === 'ar'
									? 'زيروفو توجه طلباتك إلى OpenAI وAnthropic وGemini وDeepSeek وغيرها عبر نقطة اتصال واحدة متوافقة مع OpenAI — بأسعار توكن مرجّحة وتحليلات حية.'
									: 'Zeruvo routes your requests to OpenAI, Anthropic, Gemini, DeepSeek and more through a single OpenAI-compatible endpoint — with weighted-token pricing and live analytics.'}
							</p>
							<div
								style={{ animationDelay: '360ms' }}
								className="animate-fade-up mt-8 flex flex-wrap items-center gap-4"
							>
								<Link
									to={dashboardTo}
									className="group inline-flex h-10 items-center gap-2 rounded-md bg-primary px-8 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:bg-primary/90 hover:shadow-md"
								>
									{user ? t('nav.dashboard') : i18n.language === 'ar' ? 'ابدأ مجاناً' : 'Start building'}
									<ArrowRight
										className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1 rtl:rotate-180 rtl:group-hover:-translate-x-1"
										aria-hidden="true"
									/>
								</Link>
								<Link
									to="/models"
									className="inline-flex h-10 items-center rounded-md border border-input bg-background/70 px-8 text-sm font-semibold shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-accent hover:text-accent-foreground"
								>
									{i18n.language === 'ar' ? 'استعرض الكتالوج' : 'Read the docs'}
								</Link>
							</div>
							<div
								style={{ animationDelay: '480ms' }}
								className="animate-fade-up mt-10 flex flex-wrap items-center gap-6 text-sm text-muted-foreground"
							>
								<span className="flex items-center gap-2">
									<Check className="h-4 w-4 text-primary" aria-hidden="true" />
									{i18n.language === 'ar' ? 'خطة مجانية بـ 10M توكن' : 'Free plan with 10M tokens'}
								</span>
								<span className="flex items-center gap-2">
									<Check className="h-4 w-4 text-primary" aria-hidden="true" />
									{i18n.language === 'ar' ? 'بدون بطاقة ائتمان' : 'No credit card required'}
								</span>
							</div>
						</div>
						<div
							style={{ animationDelay: '300ms' }}
							className="animate-soft-in relative flex items-center justify-center lg:justify-end"
						>
							<NetworkField />
						</div>
					</div>
				</section>

				{/* ============ PROVIDER MARQUEE ============ */}
				<section className="border-y border-border px-4 py-10 sm:px-6 lg:px-8">
					<div className="mx-auto max-w-7xl">
						<Reveal>
							<p className="mb-8 text-center font-display text-sm font-medium uppercase tracking-wider text-muted-foreground">
								{i18n.language === 'ar' ? 'أسماء كبرى الذكاء الاصطناعي' : 'The biggest names in AI'}
							</p>
						</Reveal>
						<Marquee
							items={BRAND_NAMES.map((name) => (
								<span
									key={name}
									className="inline-flex items-center gap-3 font-display text-xl font-semibold text-muted-foreground/70 transition-colors duration-300 hover:text-foreground"
								>
									<ProviderMark name={name} className="h-6 w-6" />
									{name}
								</span>
							))}
						/>
					</div>
				</section>

				{/* ============ STATS ============ */}
				<section className="px-4 py-20 sm:px-6 lg:px-8">
					<div className="mx-auto grid max-w-7xl gap-10 sm:grid-cols-2 lg:grid-cols-4">
						{[
							{ end: 99.9, decimals: 1, suffix: '%', label: i18n.language === 'ar' ? 'جهوزية البوابة' : 'Gateway uptime' },
							{ end: Math.max(totalModels, 0), suffix: '', label: i18n.language === 'ar' ? 'موديل متاح الآن' : 'Models live now' },
							{ end: 42, suffix: 'ms', label: i18n.language === 'ar' ? 'زمن التوجيه' : 'Routing overhead' },
							{ end: 3, suffix: '', label: i18n.language === 'ar' ? 'بروتوكولات أصلية' : 'Native protocols' },
						].map((stat, index) => (
							<Reveal key={stat.label} delay={index * 100}>
								<div className="text-center">
									<CountUp
										end={stat.end}
										decimals={stat.decimals ?? 0}
										suffix={stat.suffix}
										className="font-display text-4xl font-semibold tracking-tight text-primary sm:text-5xl"
									/>
									<p className="mt-2 text-sm text-muted-foreground">{stat.label}</p>
								</div>
							</Reveal>
						))}
					</div>
				</section>

				{/* ============ FEATURES ============ */}
				<section className="px-4 py-20 sm:px-6 lg:px-8">
					<div className="mx-auto max-w-7xl">
						<Reveal className="mb-12 max-w-2xl">
							<h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
								{i18n.language === 'ar' ? 'كل ما تديره البوابة عنك' : 'Everything the gateway handles for you'}
							</h2>
							<p className="mt-4 text-lg text-muted-foreground">
								{i18n.language === 'ar'
									? 'التوجيه، والفوترة، والمراقبة، وإدارة المفاتيح في طبقة واحدة.'
									: 'Routing, billing, observability and key management in one layer.'}
							</p>
						</Reveal>
						<div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
							{features.map((feature, index) => (
								<Reveal key={feature.key} delay={index * 90} className="h-full">
									<Card className="group hover-lift h-full border-border bg-card hover:border-primary/50">
										<CardHeader>
											<div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 transition-colors duration-300 group-hover:bg-primary/20">
												<feature.icon
													className="h-5 w-5 text-primary transition-transform duration-300 group-hover:animate-bounce-soft"
													aria-hidden="true"
												/>
											</div>
											<CardTitle className="font-display text-lg">
												{i18n.language === 'ar' && feature.key === 'endpoint' ? 'نقطة اتصال واحدة لكل الموديلات'
													: i18n.language === 'ar' && feature.key === 'failover' ? 'تحويل تلقائي عند الأعطال'
													: i18n.language === 'ar' && feature.key === 'billing' ? 'فوترة توكن مرجّحة'
													: i18n.language === 'ar' && feature.key === 'keys' ? 'مفاتيح تحت سيطرتك'
													: i18n.language === 'ar' && feature.key === 'analytics' ? 'تحليلات حية'
													: i18n.language === 'ar' && feature.key === 'streaming' ? 'بث مباشر افتراضيًا'
													: feature.fallback[0]}
											</CardTitle>
										</CardHeader>
										<CardContent>
											<CardDescription className="text-sm leading-relaxed text-muted-foreground">
												{feature.fallback[1]}
											</CardDescription>
										</CardContent>
									</Card>
								</Reveal>
							))}
						</div>
					</div>
				</section>

				{/* ============ LIVE CATALOG ============ */}
				<section className="border-y border-border px-4 py-20 sm:px-6 lg:px-8">
					<div className="mx-auto max-w-7xl">
						<Reveal className="mb-12 flex flex-wrap items-end justify-between gap-4">
							<div className="max-w-2xl">
								<h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
									{i18n.language === 'ar' ? 'كتالوج يكبر باستمرار' : 'A catalog that keeps growing'}
								</h2>
								<p className="mt-4 text-lg text-muted-foreground">
									{i18n.language === 'ar'
										? 'كل موديل يعرض معامله المرجّح مقدمًا. لا فواتير مفاجئة.'
										: 'Each model shows its weighted multiplier up front. No surprise invoices.'}
								</p>
							</div>
							<Link
								to="/models"
								className="inline-flex h-9 items-center rounded-md border border-input bg-background/70 px-4 text-sm font-semibold shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:bg-accent"
							>
								{i18n.language === 'ar' ? 'استعرض كل الموديلات' : 'Browse all models'}
							</Link>
						</Reveal>

						<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
							{catalogPreview.map((model, index) => (
								<Reveal key={model.id} delay={index * 70} className="h-full">
									<ModelCard model={model} />
								</Reveal>
							))}
							{catalogPreview.length === 0 && (
								<p className="col-span-full py-10 text-center text-sm text-muted-foreground">
									<Search className="mx-auto mb-2 h-5 w-5 opacity-40" /> {t('common.loading')}…
								</p>
							)}
						</div>
					</div>
				</section>

				{/* ============ QUICKSTART ============ */}
				<section className="px-4 py-20 sm:px-6 lg:px-8">
					<div className="mx-auto max-w-7xl">
						<div className="grid gap-12 lg:grid-cols-2 lg:items-center">
							<Reveal>
								<div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-md bg-primary/10">
									<Terminal className="h-5 w-5 text-primary" aria-hidden="true" />
								</div>
								<h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
									{i18n.language === 'ar' ? 'غيّر سطرًا واحدًا واحتفظ ببنيتك' : 'Change one line, keep your stack'}
								</h2>
								<p className="mt-4 text-lg leading-relaxed text-muted-foreground" dir="ltr">
									Point your existing OpenAI client at{' '}
									<span className="font-mono text-primary">api.zeruvo.online/v1</span> and pass your Zeruvo key.
									Anthropic and Gemini native routes are available too.
								</p>
								<div className="mt-8 flex flex-wrap gap-4">
									<Link to="/docs" className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-transform duration-300 hover:-translate-y-0.5">
										{i18n.language === 'ar' ? 'وثائق API الكاملة' : 'Full API docs'}
									</Link>
									<Link to="/pricing" className="inline-flex h-9 items-center rounded-md border border-input bg-background/70 px-4 text-sm font-semibold shadow-sm transition-transform duration-300 hover:-translate-y-0.5 hover:bg-accent">
										{i18n.language === 'ar' ? 'شاهد الأسعار' : 'See pricing'}
									</Link>
								</div>
							</Reveal>
							<Reveal delay={150} className="overflow-hidden rounded-lg border border-border bg-card">
								<div className="flex items-center gap-2 border-b border-border px-4 py-3">
									<div className="h-3 w-3 rounded-full bg-primary/30" />
									<div className="h-3 w-3 rounded-full bg-primary/30" />
									<div className="h-3 w-3 rounded-full bg-primary/30" />
									<span className="ml-2 text-xs text-muted-foreground">quickstart.py</span>
								</div>
								<pre className="overflow-x-auto p-4 text-sm leading-relaxed text-muted-foreground" dir="ltr">
									<code>{`from openai import OpenAI

client = OpenAI(
    base_url="https://api.zeruvo.online/v1",
    api_key="zrv_live_...",
)

response = client.chat.completions.create(
    model="gpt-5.1",
    messages=[{"role": "user", "content": "Hello Zeruvo"}],
    stream=True,
)`}</code>
									<span className="animate-caret ml-1 inline-block h-4 w-2 translate-y-0.5 bg-primary" />
								</pre>
							</Reveal>
						</div>
					</div>
				</section>

				{/* ============ CTA ============ */}
				<section className="px-4 pb-24 sm:px-6 lg:px-8">
					<div className="mx-auto max-w-7xl">
						{hasOffer && (
							<Reveal>
								<Link
									to="/dashboard/wallet"
									className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-teal-500/40 bg-teal-500/10 px-6 py-5 transition-colors hover:bg-teal-500/15"
								>
									<span className="flex items-center gap-3">
										<Gift className="h-5 w-5 shrink-0 text-teal-400" aria-hidden="true" />
										<span>
											<span className="block text-sm font-semibold">
												{i18n.language === 'ar' ? 'لديك رصيد مجاني بانتظارك!' : 'You have free credit waiting!'}
											</span>
											<span className="block text-xs text-muted-foreground">
												{i18n.language === 'ar' ? 'استلمه الآن من محفظتك واستخدمه على موديلات مختارة.' : 'Claim it from your wallet and spend it on selected models.'}
											</span>
										</span>
									</span>
									<span className="inline-flex items-center gap-2 rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white">
										{i18n.language === 'ar' ? 'استلام الرصيد' : 'Claim credit'}
										<ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
									</span>
								</Link>
							</Reveal>
						)}
						<Reveal>
							<Card className="border-border bg-card">
								<CardContent className="flex flex-wrap items-center justify-between gap-6 p-10">
									<div className="max-w-xl">
										<h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
											{i18n.language === 'ar' ? 'ابدأ على الخطة المجانية اليوم' : 'Start on the free plan today'}
										</h2>
										<p className="mt-3 text-muted-foreground">
											{i18n.language === 'ar'
												? '10M توكن مرجّح يوميًا على الموديلات المجانية. رقّ متى ما كبرت حاجتك.'
												: '10M weighted tokens per day on free models. Upgrade whenever your traffic grows.'}
										</p>
									</div>
									<Link
										to={dashboardTo}
										className="group inline-flex h-10 items-center gap-2 rounded-md bg-primary px-8 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:bg-primary/90"
									>
										{i18n.language === 'ar' ? 'افتح الكونسول' : 'Open the console'}
										<ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1 rtl:rotate-180 rtl:group-hover:-translate-x-1" aria-hidden="true" />
									</Link>
								</CardContent>
							</Card>
						</Reveal>
					</div>
				</section>
			</main>
			<NewSiteFooter legal={[
				{ to: '/privacy', label: i18n.language === 'ar' ? 'سياسة الخصوصية' : 'Privacy' },
				{ to: '/refund', label: i18n.language === 'ar' ? 'سياسة الاسترجاع' : 'Refund policy' },
			]} />
		</div>
	);
}
