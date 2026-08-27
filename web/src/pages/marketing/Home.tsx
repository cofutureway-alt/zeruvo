import { lazy, Suspense, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SplitText, CountUp, SpotlightCard, Reveal, SignalDot } from '../../components/fx';

const HeroScene = lazy(() => import('../../hero/HeroScene'));

const copy = {
	en: {
		badge: 'One key · Every frontier model',
		title: 'Route every model',
		accent: 'through one gate',
		sub: 'Zeruvo sits between your app and OpenAI, Anthropic, Gemini and 400+ more — one endpoint, weighted token plans, live logs and automatic failover.',
		cta: 'Start free',
		secondary: 'Browse the catalog',
	},
	ar: {
		badge: 'مفتاح واحد · كل موديلات الحدود',
		title: 'وجّه كل الموديلات',
		accent: 'من بوابة واحدة',
		sub: 'زيروفو تقف بين تطبيقك وOpenAI وAnthropic وGemini وأكثر من 400 موديل — نقطة اتصال واحدة، خطط توكن مرجّحة، سجلات لحظية وتحويل تلقائي.',
		cta: 'ابدأ مجاناً',
		secondary: 'استعرض الكتالوج',
	},
	fr: {
		badge: 'Une clé · Tous les modèles',
		title: 'Acheminez tous les modèles',
		accent: 'par une seule porte',
		sub: "Zeruvo se place entre votre application et OpenAI, Anthropic, Gemini et plus de 400 autres — un seul endpoint.",
		cta: 'Commencer gratuitement',
		secondary: 'Parcourir le catalogue',
	},
	zh: {
		badge: '一把钥匙 · 所有前沿模型',
		title: '所有模型，',
		accent: '一个网关',
		sub: 'Zeruvo 位于您的应用与 OpenAI、Anthropic、Gemini 等 400 多种模型之间——单一端点、加权令牌方案、实时日志与自动故障转移。',
		cta: '免费开始',
		secondary: '浏览目录',
	},
} as const;

export default function Home() {
	const { i18n, t } = useTranslation();
	const lng = (i18n.language in copy ? i18n.language : 'en') as keyof typeof copy;
	const c = copy[lng];
	const [show3d, setShow3d] = useState(false);

	useEffect(() => {
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		const id = setTimeout(() => setShow3d(true), 350);
		return () => clearTimeout(id);
	}, []);

	return (
		<main>
			{/* ================= HERO ================= */}
			<section className="nx-grid-bg relative overflow-hidden">
				<div className="mx-auto grid max-w-6xl items-center gap-8 px-6 pb-28 pt-16 md:min-h-[88vh] md:grid-cols-[1.05fr_0.95fr] md:pt-20">
					<div>
						<p className="inline-flex items-center gap-2.5 rounded-full border border-[var(--nx-border)] bg-[var(--nx-bg-raised)] px-4 py-1.5 font-data text-[11px] tracking-wide text-[var(--nx-muted)]">
							<SignalDot />
							{c.badge}
						</p>

						<h1 className="font-display mt-7 text-[2.6rem] font-bold leading-[1.04] md:text-6xl">
							<SplitText text={c.title} />
							<br />
							<span className="shiny-text">
								<SplitText text={c.accent} delay={260} />
							</span>
						</h1>

						<p className="mt-6 max-w-lg leading-relaxed text-[var(--nx-muted)]">{c.sub}</p>

						<div className="mt-9 flex flex-wrap items-center gap-4">
							<Link
								to="/signup"
								className="group flex items-center gap-2 rounded-xl bg-[var(--nx-accent)] px-7 py-3.5 text-sm font-semibold text-[#08080f] shadow-[0_0_32px_rgba(139,124,255,0.35)] transition hover:bg-[var(--nx-accent-strong)] hover:shadow-[0_0_44px_rgba(139,124,255,0.5)]"
							>
								{c.cta}
								<ArrowRight size={16} className="transition-transform group-hover:translate-x-1 rtl:rotate-180 rtl:group-hover:-translate-x-1" />
							</Link>
							<Link
								to="/models"
								className="flex items-center gap-1.5 rounded-xl border border-[var(--nx-border-bright)] px-6 py-3.5 text-sm font-semibold text-zinc-200 transition hover:border-[var(--nx-accent)]/60 hover:text-white"
							>
								{c.secondary}
								<ArrowUpRight size={15} className="opacity-60" />
							</Link>
						</div>
					</div>

					{/* signature: routing core + floating model badges */}
					<div className="relative mx-auto aspect-square w-full max-w-[30rem]">
						<div className="absolute inset-[12%] rounded-full bg-[radial-gradient(circle_at_38%_34%,rgba(139,124,255,0.42),rgba(139,124,255,0.08)_52%,transparent_72%)] blur-2xl" />
						{show3d && (
							<div className="absolute inset-0">
								<Suspense fallback={<div className="size-full" />}>
									<HeroScene />
								</Suspense>
							</div>
						)}
						<HeroBadge className="left-[2%] top-[16%]" label="claude-opus" ms={214} delay="0.9s" />
						<HeroBadge className="right-[0%] top-[38%]" label="gpt-5.6" ms={187} delay="1.25s" />
						<HeroBadge className="bottom-[20%] left-[10%]" label="gemini-flash" ms={142} delay="1.6s" />
					</div>
				</div>
			</section>

			{/* ================= PROOF STRIP ================= */}
			<section className="border-y border-[var(--nx-border)] bg-[var(--nx-bg-raised)]/60">
				<div className="mx-auto grid max-w-6xl grid-cols-2 divide-x divide-[var(--nx-border)] px-6 md:grid-cols-4 rtl:divide-x-reverse">
					<Stat value={402} suffix="+" label="models in catalog" />
					<Stat value={23} suffix="" label="upstream providers" />
					<Stat value={3} suffix="" label="native protocols" />
					<Stat value={99} suffix=".9%" label="gateway uptime" />
				</div>
			</section>

			{/* ================= FEATURES ================= */}
			<section className="mx-auto max-w-6xl px-6 py-24">
				<Reveal>
					<p className="font-data text-xs uppercase tracking-[0.22em] text-[var(--nx-accent)]">{t('nav.docs')}</p>
					<h2 className="font-display mt-3 max-w-xl text-3xl font-bold md:text-4xl">
						{lng === 'ar' ? 'كل ما تحتاجه بينك وبين الذكاء' : lng === 'zh' ? '连接智能所需的一切' : 'Everything between you and the models'}
					</h2>
				</Reveal>
				<div className="mt-10 grid gap-4 md:grid-cols-3">
					<Reveal delay={0}>
						<SpotlightCard className="h-full p-7">
							<p className="font-data text-[11px] text-[var(--nx-mint)]">POST /v1/chat/completions</p>
							<h3 className="font-display mt-3 text-lg font-semibold">OpenAI-compatible</h3>
							<p className="mt-2 text-sm leading-relaxed text-[var(--nx-muted)]">
								Point any existing SDK at the gateway — chat, streaming, tools and vision work without code changes.
							</p>
						</SpotlightCard>
					</Reveal>
					<Reveal delay={120}>
						<SpotlightCard className="h-full p-7">
							<p className="font-data text-[11px] text-[var(--nx-mint)]">/v1/messages · :generateContent</p>
							<h3 className="font-display mt-3 text-lg font-semibold">Native protocols too</h3>
							<p className="mt-2 text-sm leading-relaxed text-[var(--nx-muted)]">
								Speak Anthropic and Gemini wire formats verbatim — no translation layer on your side.
							</p>
						</SpotlightCard>
					</Reveal>
					<Reveal delay={240}>
						<SpotlightCard className="h-full p-7">
							<p className="font-data text-[11px] text-[var(--nx-mint)]">×1 … ×50 weighted tokens</p>
							<h3 className="font-display mt-3 text-lg font-semibold">Usage you can trust</h3>
							<p className="mt-2 text-sm leading-relaxed text-[var(--nx-muted)]">
								Atomic per-token accounting against daily allowances, with complete request logs.
							</p>
						</SpotlightCard>
					</Reveal>
				</div>
			</section>
		</main>
	);
}

function Stat(props: { value: number; suffix: string; label: string }) {
	return (
		<div className="px-6 py-8 text-center">
			<p className="font-display text-3xl font-bold tabular-nums text-white md:text-4xl">
				<CountUp to={props.value} suffix={props.suffix} />
			</p>
			<p className="mt-1 text-xs text-[var(--nx-muted)]">{props.label}</p>
		</div>
	);
}

function HeroBadge(props: { className: string; label: string; ms: number; delay: string }) {
	return (
		<div
			className={`absolute flex items-center gap-2 rounded-full border border-[var(--nx-border-bright)] bg-[var(--nx-surface)]/90 px-3 py-1.5 backdrop-blur-sm ${props.className}`}
			style={{ animation: `badge-float 6s ease-in-out ${props.delay} infinite` }}
		>
			<span className="font-data text-[11px] text-zinc-200">{props.label}</span>
			<span className="font-data text-[11px] tabular-nums text-[var(--nx-mint)]">{props.ms}ms</span>
		</div>
	);
}
