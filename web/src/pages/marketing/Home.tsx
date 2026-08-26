import { lazy, Suspense, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Zap, Globe2, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const HeroScene = lazy(() => import('../../hero/HeroScene'));

const copy = {
	en: {
		badge: 'One API. Every model.',
		title: 'The unified gateway to',
		accent: 'frontier AI',
		sub: 'Route OpenAI, Anthropic, Gemini and hundreds more through a single endpoint — with usage-based plans, real-time logs and automatic failover.',
		cta: 'Start free',
		secondary: 'View models',
	},
	ar: {
		badge: 'واجهة واحدة. كل الموديلات.',
		title: 'البوابة الموحدة إلى',
		accent: 'ذكاء الحدود',
		sub: 'وجّه OpenAI وAnthropic وGemini ومئات الموديلات عبر نقطة اتصال واحدة — مع خطط بالاستهلاك وسجلات لحظية وتحويل تلقائي عند الأعطال.',
		cta: 'ابدأ مجاناً',
		secondary: 'استعرض الموديلات',
	},
	fr: {
		badge: 'Une API. Tous les modèles.',
		title: 'La passerelle unifiée vers',
		accent: "l'IA de pointe",
		sub: "Acheminez OpenAI, Anthropic, Gemini et des centaines d'autres via un seul endpoint.",
		cta: 'Commencer gratuitement',
		secondary: 'Voir les modèles',
	},
	zh: {
		badge: '一个接口，全部模型。',
		title: '通往',
		accent: '前沿AI的统一网关',
		sub: '通过单一端点路由 OpenAI、Anthropic、Gemini 及数百种模型——按用量计费、实时日志、自动故障转移。',
		cta: '免费开始',
		secondary: '浏览模型',
	},
} as const;

export default function Home() {
	const { i18n, t } = useTranslation();
	const lng = (i18n.language in copy ? i18n.language : 'en') as keyof typeof copy;
	const c = copy[lng];
	const [show3d, setShow3d] = useState(false);

	useEffect(() => {
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		const id = setTimeout(() => setShow3d(true), 500);
		return () => clearTimeout(id);
	}, []);

	return (
		<main>
			<section className="relative overflow-hidden">
				<div className="mx-auto grid max-w-6xl items-center gap-10 px-6 pb-24 pt-20 md:grid-cols-2 md:pt-28">
					<div>
						<p className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-300">
							<Zap size={12} />
							{c.badge}
						</p>
						<h1 className="mt-5 text-4xl font-bold leading-tight tracking-tight md:text-5xl">
							{c.title}{' '}
							<span className="bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">
								{c.accent}
							</span>
						</h1>
						<p className="mt-5 max-w-lg leading-relaxed text-[var(--nx-muted)]">{c.sub}</p>
						<div className="mt-8 flex flex-wrap gap-3">
							<Link
								to="/signup"
								className="flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500"
							>
								{c.cta}
								<ArrowRight size={16} className="rtl:rotate-180" />
							</Link>
							<Link
								to="/models"
								className="rounded-xl border border-[var(--nx-border)] px-6 py-3 text-sm font-semibold text-zinc-200 transition hover:border-zinc-600"
							>
								{c.secondary}
							</Link>
						</div>
						<div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-xs text-[var(--nx-muted)]">
							<span className="flex items-center gap-1.5"><Globe2 size={13} />23+ providers</span>
							<span className="flex items-center gap-1.5"><Zap size={13} />&lt;50ms added latency</span>
							<span className="flex items-center gap-1.5"><ShieldCheck size={13} />Bank-grade key security</span>
						</div>
					</div>

					<div className="relative mx-auto aspect-square w-full max-w-md">
						<div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_35%_35%,rgba(99,102,241,0.5),rgba(124,58,237,0.18)_45%,transparent_70%)] blur-xl" />
						{show3d && (
							<div className="absolute inset-0">
								<Suspense fallback={<div className="size-full" />}>
									<HeroScene />
								</Suspense>
							</div>
						)}
					</div>
				</div>
			</section>

			<section className="mx-auto grid max-w-6xl gap-4 px-6 pb-24 md:grid-cols-3">
				<FeatureCard title="OpenAI-compatible" body="Point any existing SDK at our endpoint — chat completions, streaming, tools and vision just work." />
				<FeatureCard title="Native protocols too" body="/v1/messages speaks Anthropic natively; Gemini's generateContent is supported verbatim." />
				<FeatureCard title={t('dashboard.logs')} body="Atomic per-token accounting with weighted multipliers, daily quotas and complete logs." />
			</section>
		</main>
	);
}

function FeatureCard(props: { title: string; body: string }) {
	return (
		<div className="rounded-2xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-6">
			<h3 className="font-semibold">{props.title}</h3>
			<p className="mt-2 text-sm leading-relaxed text-[var(--nx-muted)]">{props.body}</p>
		</div>
	);
}
