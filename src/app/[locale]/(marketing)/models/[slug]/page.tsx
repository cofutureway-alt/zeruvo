import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

interface Props {
	params: Promise<{ locale: string; slug: string }>;
}

/** Public per-model page — generated from DB, gold for SEO. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
	const { slug } = await params;
	const supabase = await createClient();
	const { data: model } = await supabase
		.from('models')
		.select('display_name,description,upstream_model_id,context_window,usage_multiplier')
		.eq('slug', decodeURIComponent(slug))
		.eq('enabled_for_users', true)
		.maybeSingle();
	if (!model) return {};
	return {
		title: model.display_name,
		description:
			model.description ??
			`Call ${model.upstream_model_id} through the Nexor AI gateway — ${(model.context_window ?? 0).toLocaleString()} token context, ×${Number(model.usage_multiplier)} weighted pricing.`,
		alternates: { canonical: `/en/models/${slug}` },
	};
}

export default async function ModelDetailPage({ params }: Props) {
	const { locale, slug } = await params;
	const supabase = await createClient();
	const { data: model } = await supabase
		.from('models')
		.select(
			'*, providers(display_name), model_categories(name,icon_url)',
		)
		.eq('slug', decodeURIComponent(slug))
		.eq('enabled_for_users', true)
		.maybeSingle();

	if (!model) notFound();

	const mult = Number(model.usage_multiplier);

	return (
		<main className="mx-auto max-w-3xl px-6 py-12">
			<Link href={`/${locale}/models`} className="text-xs text-[var(--nx-muted)] hover:text-indigo-300">
				← All models
			</Link>

			<header className="mt-4 flex items-start justify-between gap-4">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight">{model.display_name}</h1>
					<p className="mt-1 font-mono text-xs text-[var(--nx-muted)]">{model.upstream_model_id}</p>
				</div>
				<span className="shrink-0 rounded-lg bg-indigo-500/10 px-3 py-1.5 text-sm font-semibold tabular-nums text-indigo-300">
					×{mult}
				</span>
			</header>

			<p className="mt-6 leading-relaxed text-[var(--nx-muted)]">
				{model.description ??
					`${model.display_name} is served through the Nexor gateway. Every token consumed is multiplied by ${mult} against your plan's daily weighted allowance.`}
			</p>

			<dl className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
				<Spec label="Provider" value={model.providers?.display_name ?? '—'} />
				<Spec
					label="Context"
					value={model.context_window ? `${(model.context_window / 1024).toFixed(0)}K tokens` : '—'}
				/>
				<Spec label="Multiplier" value={`×${mult}`} />
				<Spec label="Category" value={model.model_categories?.name ?? '—'} />
			</dl>

			<section className="mt-10 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-5">
				<h2 className="text-sm font-semibold">Quick start</h2>
				<pre className="mt-3 overflow-x-auto rounded-lg bg-zinc-900 p-4 font-mono text-xs leading-relaxed text-zinc-300" dir="ltr">
{`curl https://nexor-gateway.alammmedd4.workers.dev/v1/chat/completions \\
  -H "Authorization: Bearer $NEXOR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${model.upstream_model_id}",
    "messages": [{"role": "user", "content": "Hello"}]
  }'`}
				</pre>
			</section>

			<a
				href={`/${locale}/signup`}
				className="mt-8 inline-flex rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-500"
			>
				Start using this model free
			</a>
		</main>
	);
}

function Spec(props: { label: string; value: string }) {
	return (
		<div className="rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-3.5">
			<dt className="text-[11px] uppercase tracking-wide text-[var(--nx-muted)]">{props.label}</dt>
			<dd className="mt-1 truncate text-sm font-medium">{props.value}</dd>
		</div>
	);
}
