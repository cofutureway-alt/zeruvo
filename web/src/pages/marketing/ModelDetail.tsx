import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { SkeletonDetail } from '../../components/skeleton';

interface ModelFull {
	display_name: string;
	description: string | null;
	upstream_model_id: string;
	context_window: number | null;
	usage_multiplier: number | string;
	providers: Array<{ display_name: string }> | null;
	model_categories: Array<{ name: string }> | null;
}

export default function ModelDetail() {
	const { slug } = useParams<{ slug: string }>();
	const [model, setModel] = useState<ModelFull | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		void (async () => {
			const { data } = await supabase
				.from('models')
				.select('display_name,description,upstream_model_id,context_window,usage_multiplier,providers(display_name),model_categories(name)')
				.eq('slug', slug)
				.eq('enabled_for_users', true)
				.maybeSingle();
			setModel(data ? (data as unknown as ModelFull) : null);
			setLoading(false);
			if (data) document.title = `${(data as ModelFull).display_name} · Nexor AI`;
		})();
	}, [slug]);

	if (loading) {
		return (
			<main className="mx-auto max-w-3xl px-6 py-12">
				<SkeletonDetail />
			</main>
		);
	}
	if (!model) {
		return (
			<main className="mx-auto max-w-3xl px-6 py-24 text-center">
				<h1 className="text-xl font-semibold">Model not found</h1>
				<Link to="/models" className="mt-4 inline-block text-sm text-indigo-400">← All models</Link>
			</main>
		);
	}

	const mult = Number(model.usage_multiplier);

	return (
		<main className="mx-auto max-w-3xl px-6 py-12">
			<Link to="/models" className="text-xs text-[var(--nx-muted)] hover:text-indigo-300">
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
				<Spec label="Provider" value={model.providers?.[0]?.display_name ?? '—'} />
				<Spec label="Context" value={model.context_window ? `${(model.context_window / 1024).toFixed(0)}K tokens` : '—'} />
				<Spec label="Multiplier" value={`×${mult}`} />
				<Spec label="Category" value={model.model_categories?.[0]?.name ?? '—'} />
			</dl>

			<section className="mt-10 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-5">
				<h2 className="text-sm font-semibold">Quick start</h2>
				<pre dir="ltr" className="mt-3 overflow-x-auto rounded-lg bg-zinc-900 p-4 font-mono text-xs leading-relaxed text-zinc-300">
{`curl https://nexor-gateway.alammmedd4.workers.dev/v1/chat/completions \\
  -H "Authorization: Bearer $NEXOR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${model.upstream_model_id}",
    "messages": [{"role": "user", "content": "Hello"}]
  }'`}
				</pre>
			</section>

			<Link
				to="/signup"
				className="mt-8 inline-flex rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-500"
			>
				Start using this model free
			</Link>
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
