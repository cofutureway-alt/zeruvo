'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { ArrowRight, Zap, Globe2, ShieldCheck } from 'lucide-react';

// Lazy: the 3D bundle never blocks first paint
const HeroScene = dynamic(() => import('./hero-scene'), {
	ssr: false,
	loading: () => <div className="size-full" />,
});

const t = {
	en: {
		badge: 'One API. Every model.',
		title: 'The unified gateway to',
		titleAccent: 'frontier AI',
		sub: 'Route OpenAI, Anthropic, Gemini and hundreds more through a single endpoint — with usage-based plans, real-time logs and automatic failover.',
		cta: 'Start free',
		secondary: 'View models',
		f1: '23+ providers',
		f2: '<50ms added latency',
		f3: 'Bank-grade key security',
	},
	ar: {
		badge: 'واجهة واحدة. كل الموديلات.',
		title: 'البوابة الموحدة إلى',
		titleAccent: 'ذكاء الحدود',
		sub: 'وجّه OpenAI وAnthropic وGemini ومئات الموديلات عبر نقطة اتصال واحدة — مع خطط بالاستهلاك وسجلات لحظية وتحويل تلقائي عند الأعطال.',
		cta: 'ابدأ مجاناً',
		secondary: 'استعرض الموديلات',
		f1: '+23 مزوداً',
		f2: 'أقل من 50ms تأخيراً',
		f3: 'أمان بمستوى البنوك',
	},
	fr: {
		badge: "Une API. Tous les modèles.",
		title: 'La passerelle unifiée vers',
		titleAccent: "l'IA de pointe",
		sub: "Acheminez OpenAI, Anthropic, Gemini et des centaines d'autres via un seul point de terminaison — avec des forfaits à l'usage, des journaux en temps réel et un basculement automatique.",
		cta: 'Commencer gratuitement',
		secondary: 'Voir les modèles',
		f1: '23+ fournisseurs',
		f2: '<50ms de latence',
		f3: 'Sécurité bancaire',
	},
	zh: {
		badge: '一个接口，全部模型。',
		title: '通往',
		titleAccent: '前沿AI的统一网关',
		sub: '通过单一端点路由 OpenAI、Anthropic、Gemini 及数百种模型——按用量计费、实时日志、自动故障转移。',
		cta: '免费开始',
		secondary: '浏览模型',
		f1: '23+ 提供商',
		f2: '延迟 <50ms',
		f3: '银行级密钥安全',
	},
} as const;

export function Hero({ locale }: { locale: string }) {
	const tr = t[locale as keyof typeof t] ?? t.en;
	const [show3d, setShow3d] = useState(false);

	useEffect(() => {
		// respect reduced motion + defer past first paint
		const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		if (reduced) return;
		let id: number | ReturnType<typeof setTimeout>;
		if ('requestIdleCallback' in window) {
			id = requestIdleCallback(() => setShow3d(true));
		} else {
			id = setTimeout(() => setShow3d(true), 600);
		}
		return () => {
			if (typeof id === 'number') {
				cancelAnimationFrame(id);
				clearTimeout(id);
			}
		};
	}, []);

	return (
		<section className="relative overflow-hidden">
			<div className="mx-auto grid max-w-6xl items-center gap-10 px-6 pb-24 pt-20 md:grid-cols-2 md:pt-28">
				<div>
					<p className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-300">
						<Zap size={12} />
						{tr.badge}
					</p>
					<h1 className="mt-5 text-4xl font-bold leading-tight tracking-tight md:text-5xl">
						{tr.title}{' '}
						<span className="bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">
							{tr.titleAccent}
						</span>
					</h1>
					<p className="mt-5 max-w-lg leading-relaxed text-[var(--nx-muted)]">{tr.sub}</p>
					<div className="mt-8 flex flex-wrap gap-3">
						<a
							href={`/${locale}/signup`}
							className="flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500"
						>
							{tr.cta}
							<ArrowRight size={16} className="rtl:rotate-180" />
						</a>
						<a
							href={`/${locale}/models`}
							className="rounded-xl border border-[var(--nx-border)] px-6 py-3 text-sm font-semibold text-zinc-200 transition hover:border-zinc-600"
						>
							{tr.secondary}
						</a>
					</div>
					<div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-xs text-[var(--nx-muted)]">
						<span className="flex items-center gap-1.5"><Globe2 size={13} />{tr.f1}</span>
						<span className="flex items-center gap-1.5"><Zap size={13} />{tr.f2}</span>
						<span className="flex items-center gap-1.5"><ShieldCheck size={13} />{tr.f3}</span>
					</div>
				</div>

				<div className="relative mx-auto aspect-square w-full max-w-md">
					{/* static gradient fallback always painted underneath */}
					<div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_35%_35%,rgba(99,102,241,0.5),rgba(124,58,237,0.18)_45%,transparent_70%)] blur-xl" />
					{show3d && (
						<div className="absolute inset-0">
							<HeroScene />
						</div>
					)}
				</div>
			</div>
		</section>
	);
}
