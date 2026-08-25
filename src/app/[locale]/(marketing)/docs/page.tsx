import { setRequestLocale } from 'next-intl/server';

export const metadata = { title: 'Docs' };

const SNIPPETS = [
	{
		title: 'OpenAI-compatible',
		code: `curl https://nexor-gateway.alammmedd4.workers.dev/v1/chat/completions \\
  -H "Authorization: Bearer $NEXOR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"openai/gpt-4o-mini","messages":[{"role":"user","content":"Hi"}]}'`,
	},
	{
		title: 'Streaming (SSE)',
		code: `curl … -d '{"model":"…","stream":true}'
# data: {"choices":[{"delta":{"content":"Hel"}}]}
# data: [DONE]`,
	},
	{
		title: 'Anthropic native',
		code: `curl https://nexor-gateway.alammmedd4.workers.dev/v1/messages \\
  -H "x-api-key: $NEXOR_API_KEY" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"anthropic/claude-sonnet-4","max_tokens":1024,
       "messages":[{"role":"user","content":"Hi"}]}'`,
	},
	{
		title: 'Gemini native',
		code: `POST /v1beta/models/gemini-2.0-flash:generateContent?key=$NEXOR_API_KEY
{"contents":[{"parts":[{"text":"Hi"}]}]}`,
	},
];

export default async function DocsPage(props: { params: Promise<{ locale: string }> }) {
	const { locale } = await props.params;
	setRequestLocale(locale);

	return (
		<main className="mx-auto max-w-3xl px-6 py-12">
			<h1 className="text-2xl font-semibold tracking-tight">API Docs</h1>
			<p className="mt-1 text-sm text-[var(--nx-muted)]">
				One key, three protocols. Create a key in your dashboard, then call:
			</p>

			<div className="mt-8 space-y-8">
				{SNIPPETS.map((s) => (
					<section key={s.title}>
						<h2 className="mb-3 text-sm font-semibold">{s.title}</h2>
						<pre
							dir="ltr"
							className="overflow-x-auto rounded-xl border border-[var(--nx-border)] bg-zinc-900 p-4 font-mono text-xs leading-relaxed text-zinc-300"
						>
							{s.code}
						</pre>
					</section>
				))}
			</div>

			<section className="mt-10 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-5 text-sm text-[var(--nx-muted)]">
				<p className="font-medium text-zinc-200">Weighted billing</p>
				<p className="mt-1">
					Tokens are billed as{' '}
					<span className="font-mono text-indigo-300">raw × model multiplier</span> against your
					daily allowance, which resets at 00:00 UTC. When the allowance is exhausted requests
					return <span className="font-mono">429 insufficient_quota</span>.
				</p>
			</section>
		</main>
	);
}
