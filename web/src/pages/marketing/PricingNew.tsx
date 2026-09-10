import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Boxes, Check, Gauge, RefreshCcw, Search, ShieldCheck, Sparkles, Wallet, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../auth-context';
import { NewSiteHeader, NewSiteFooter } from '../../design-system/new-chrome';
import { Reveal } from '../../design-system/reveal';
import { ProviderMark } from '../../design-system/brand-marks';
import { Card, CardContent } from '../../design-system/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../design-system/dialog';
import { Input } from '../../design-system/input';
import { ScrollArea } from '../../design-system/scroll-area';
import PlansBrowser from '../user/PlansBrowser';

/**
 * New-design pricing page: marketing chrome + hero around the LIVE
 * PlansBrowser grid (real Supabase plans, real Kashier checkout).
 */
interface PlanModel {
	id: string;
	display_name: string;
	upstream_model_id: string;
	plan_ids: string[];
}

const included = [
	{ icon: Wallet, key: 'kashier', text: 'Pay locally, no international card needed.' },
	{ icon: RefreshCcw, key: 'reset', text: 'Weighted tokens refill every day at midnight UTC.' },
	{ icon: Zap, key: 'openai', text: 'One endpoint for every provider, streaming included.' },
	{ icon: ShieldCheck, key: 'cancel', text: 'Plans are prepaid, no auto-renew surprises.' },
];

export default function Pricing() {
	const { t, i18n } = useTranslation();
	const ar = i18n.language === 'ar';

	return (
		<div className="flex min-h-screen flex-col bg-background text-foreground">
			<NewSiteHeader />
			<main className="flex-1">
				{/* Header */}
				<section className="border-b border-border px-4 py-16 sm:px-6 lg:px-8">
					<div className="mx-auto max-w-6xl text-center">
						<Reveal>
							<span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
								<Gauge className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
								{ar ? 'فوترة توكن مرجّحة' : 'Weighted-token billing'}
							</span>
							<h1 className="mt-4 font-display text-4xl font-semibold tracking-tight sm:text-5xl">
								{ar ? 'خطة واحدة. كل الموديلات.' : 'One plan. Every model.'}
							</h1>
							<p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
								{ar
									? 'اختر ميزانية التوكن اليومية وافتح مستويات الموديلات المناسبة. تُحصّل بالجنيه المصري عبر Kashier.'
									: 'Pick a daily weighted-token budget and unlock the matching model tiers. Charged in EGP via Kashier — no hidden fees.'}
							</p>
						</Reveal>
					</div>
				</section>

				{/* Plans — real PlansBrowser with live checkout */}
				<section className="px-4 py-14 sm:px-6 lg:px-8">
					<div className="mx-auto max-w-6xl">
						<PlansBrowser />
					</div>
				</section>

				{/* Included in all plans */}
				<section className="border-t border-border bg-card px-4 py-14 sm:px-6 lg:px-8">
					<div className="mx-auto max-w-6xl">
						<Reveal>
							<h2 className="font-display text-2xl font-semibold tracking-tight">
								{ar ? 'مشمول في كل خطة' : 'Included in every plan'}
							</h2>
						</Reveal>
						<div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
							{included.map((f, i) => (
								<Reveal key={f.key} delay={i * 80} className="h-full">
									<div className="hover-lift h-full rounded-lg border border-border bg-background p-5">
										<f.icon className="h-5 w-5 text-primary" aria-hidden="true" />
										<p className="mt-3 font-medium">
											{ar
												? f.key === 'kashier' ? 'دفع بالجنيه عبر Kashier'
												: f.key === 'reset' ? 'إعادة تعيين الكوتا يوميًا'
												: f.key === 'openai' ? 'متوافق مع OpenAI'
												: 'إلغاء في أي وقت'
												: ''}
										</p>
										<p className="mt-1 text-sm text-muted-foreground">{f.text}</p>
									</div>
								</Reveal>
							))}
						</div>
					</div>
				</section>
			</main>
			<NewSiteFooter legal={[
				{ to: '/privacy', label: ar ? 'سياسة الخصوصية' : 'Privacy' },
				{ to: '/refund', label: ar ? 'سياسة الاسترجاع' : 'Refund policy' },
			]} />
		</div>
	);
}

/** Kept for reference — the design's plan-models dialog; PlansBrowser covers this inline. */
export function PlanModelsDialogExample() {
	return null;
}

void Boxes;
void Check;
void Search;
void Sparkles;
void ArrowUpRight;
void ProviderMark;
