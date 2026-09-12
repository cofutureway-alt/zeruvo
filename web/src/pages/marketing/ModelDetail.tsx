import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { NewSiteHeader, NewSiteFooter } from '../../design-system/new-chrome';
import { Reveal } from '../../design-system/reveal';
import { ProviderMark } from '../../design-system/brand-marks';
import { Card, CardContent } from '../../design-system/card';

interface ModelFull {
	display_name: string;
	description: string | null;
	upstream_model_id: string;
	context_window: number | null;
	usage_multiplier: number | string;
	
	model_categories: Array<{ name: string }> | null;
}

/** New-design model detail page (standalone chrome, live Supabase data). */
export default function ModelDetail() {
	const { t, i18n } = useTranslation();
	const { slug } = useParams<{ slug: string }>();
	const [model, setModel] = useState<ModelFull | null>(null);
	const [loading, setLoading] = useState(true);
	const ar = i18n.language === 'ar';

	useEffect(() => {
		void (async () => {
			const { data } = await supabase
				.from('models')
				.select('display_name,description,upstream_model_id,context_window,usage_multiplier,model_categories(name)')
				.eq('slug', slug)
				.eq('enabled_for_users', true)
				.maybeSingle();
			setModel(data ? (data as unknown as ModelFull) : null);
			setLoading(false);
			if (data) document.title = `${(data as ModelFull).display_name} · Zeruvo AI`;
		})();
	}, [slug]);

	if (loading) {
		return (
			<div className="flex min-h-screen flex-col bg-background text-foreground">
				<NewSiteHeader />
				<main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
					<div className="h-8 w-56 animate-pulse rounded bg-muted" />
					<div className="mt-6 h-24 animate-pulse rounded bg-muted" />
				</main>
			</div>
		);
	}
	if (!model) {
		return (
			<div className="flex min-h-screen flex-col bg-background text-foreground">
				<NewSiteHeader />
				<main className="mx-auto w-full max-w-3xl flex-1 px-6 py-24 text-center">
					<h1 className="font-display text-xl font-semibold">{ar ? 'الموديل غير موجود' : 'Model not found'}</h1>
					<Link to="/models" className="mt-4 inline-block text-sm text-primary">← {ar ? 'كل الموديلات' : 'All models'}</Link>
				</main>
				<NewSiteFooter />
			</div>
		);
	}

	const mult = Number(model.usage_multiplier);

	return (
		<div className="flex min-h-screen flex-col bg-background text-foreground">
			<NewSiteHeader />
			<main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
				<Link to="/models" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
					<ArrowLeft size={13} className="rtl:rotate-180" />
					{ar ? 'كل الموديلات' : 'All models'}
				</Link>

				<Reveal>
					<header className="mt-4 flex items-start justify-between gap-4">
						<div>
							<h1 className="font-display text-2xl font-semibold tracking-tight">{model.display_name}</h1>
							<p className="mt-1 font-mono text-xs text-muted-foreground">{model.upstream_model_id}</p>
						</div>
						<span className="shrink-0 rounded bg-primary/15 px-3 py-1.5 font-mono text-sm font-semibold tabular-nums text-primary">
							×{mult}
						</span>
					</header>

					<p className="mt-6 leading-relaxed text-muted-foreground">
						{model.description ??
							`${model.display_name} is served through the Zeruvo gateway. Every token consumed is multiplied by ${mult} against your plan's daily weighted allowance.`}
					</p>
				</Reveal>

				<Reveal delay={100}>
					<dl className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
						<Spec label={ar ? 'الفئة' : 'Category'} value={model.model_categories?.[0]?.name ?? 'AI Models'} mark={model.model_categories?.[0]?.name ?? ''} />
						<Spec label={ar ? 'السياق' : 'Context'} value={model.context_window ? `${(model.context_window / 1024).toFixed(0)}K tokens` : '—'} />
						<Spec label={ar ? 'المعامل' : 'Multiplier'} value={`×${mult}`} />
						
					</dl>
				</Reveal>

				<Reveal delay={160}>
					<section className="mt-10 overflow-hidden rounded-lg border border-border bg-card transition-colors duration-300 hover:border-primary/50">
						<div className="flex items-center gap-2 border-b border-border px-4 py-3">
							<div className="h-3 w-3 rounded-full bg-primary/30" />
							<div className="h-3 w-3 rounded-full bg-primary/30" />
							<div className="h-3 w-3 rounded-full bg-primary/30" />
							<span className="ml-2 text-xs text-muted-foreground">quickstart.sh</span>
						</div>
						<pre dir="ltr" className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-muted-foreground">
{`curl ${import.meta.env.VITE_GATEWAY_URL ?? 'https://api.zeruvo.online'}/v1/chat/completions \\
  -H "Authorization: Bearer $ZERUVO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${model.upstream_model_id}",
    "messages": [{"role": "user", "content": "Hello"}]
  }'`}
						</pre>
					</section>
				</Reveal>

				<Link
					to="/signup"
					className="mt-8 inline-flex items-center rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:bg-primary/90"
				>
					{ar ? 'ابدأ باستخدام هذا الموديل مجانًا' : 'Start using this model free'}
				</Link>
			</main>
			<NewSiteFooter legal={[
				{ to: '/privacy', label: ar ? 'سياسة الخصوصية' : 'Privacy' },
				{ to: '/refund', label: ar ? 'سياسة الاسترجاع' : 'Refund policy' },
			]} />
		</div>
	);
}

function Spec({ label, value, mark }: { label: string; value: string; mark?: string }) {
	return (
		<div className="rounded-lg border border-border bg-card p-3.5">
			<dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
			<dd className="mt-1 flex items-center gap-1.5 truncate text-sm font-medium">
				{mark && <ProviderMark name={mark} className="h-4 w-4 shrink-0" />}
				{value}
			</dd>
		</div>
	);
}

void Card;
void CardContent;
