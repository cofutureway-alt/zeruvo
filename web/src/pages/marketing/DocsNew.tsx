import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NewSiteHeader, NewSiteFooter } from '../../design-system/new-chrome';
import { Reveal } from '../../design-system/reveal';

const GATEWAY = import.meta.env.VITE_GATEWAY_URL ?? 'https://api.zeruvo.online';

const snippets = [
	{
		title: 'OpenAI-compatible',
		code: `curl ${GATEWAY}/v1/chat/completions \\
  -H "Authorization: Bearer $ZERUVO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"openai/gpt-4o-mini","messages":[{"role":"user","content":"Hi"}]}'`,
	},
	{
		title: 'Streaming (SSE)',
		code: `curl ... -d '{"model":"...","stream":true}'
# data: {"choices":[{"delta":{"content":"Hel"}}]}
# data: [DONE]`,
	},
	{
		title: 'Anthropic native',
		code: `curl ${GATEWAY}/v1/messages \\
  -H "x-api-key: $ZERUVO_API_KEY" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"claude-sonnet-5","max_tokens":1024,
       "messages":[{"role":"user","content":"Hi"}]}'`,
	},
	{
		title: 'Gemini native',
		code: `POST ${GATEWAY}/v1beta/models/gemini-2.0-flash:generateContent?key=$ZERUVO_API_KEY
{"contents":[{"parts":[{"text":"Hi"}]}]}`,
	},
];

export default function Docs() {
	const { t, i18n } = useTranslation();
	const ar = i18n.language === 'ar';

	return (
		<div className="flex min-h-screen flex-col bg-background text-foreground">
			<NewSiteHeader />
			<main className="flex-1 px-4 py-14 sm:px-6 lg:px-8">
				<div className="mx-auto max-w-3xl">
					<Reveal>
						<h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">API Docs</h1>
						<p className="mt-3 text-muted-foreground">
							{ar
								? 'مفتاح واحد، أربع بروتوكولات. أنشئ مفتاحًا من لوحتك ثم اتصل:'
								: 'One key, four protocols. Create a key in your dashboard, then call:'}
						</p>
					</Reveal>

					<div className="mt-10 space-y-10">
						{snippets.map((snippet, index) => (
							<Reveal key={snippet.title} delay={index * 80}>
								<h2 className="font-display text-lg font-semibold">{snippet.title}</h2>
								<CodeBlock code={snippet.code} />
							</Reveal>
						))}
					</div>

					<Reveal delay={200}>
						<section className="mt-12 rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
							<p className="font-medium text-foreground">{ar ? 'الفوترة المرجّحة' : 'Weighted billing'}</p>
							<p className="mt-1">
								{ar ? 'يُحسب التوكن كـ ' : 'Tokens are billed as '}
								<span className="font-mono text-primary">raw × model multiplier</span>
								{ar
									? ' من رصيدك اليومي، ويتجدد في 00:00 UTC. عند نفاد الرصيد ترجع البوابة 429.'
									: " against your daily allowance, which resets at 00:00 UTC. When the allowance is exhausted requests return 429."}
							</p>
						</section>
					</Reveal>
				</div>
			</main>
			<NewSiteFooter legal={[
				{ to: '/privacy', label: ar ? 'سياسة الخصوصية' : 'Privacy' },
				{ to: '/refund', label: ar ? 'سياسة الاسترجاع' : 'Refund policy' },
			]} />
		</div>
	);
}

function CodeBlock({ code }: { code: string }) {
	const [copied, setCopied] = useState(false);

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(code);
			setCopied(true);
			setTimeout(() => setCopied(false), 1600);
		} catch {
			setCopied(false);
		}
	};

	return (
		<div className="group relative mt-3 overflow-hidden rounded-lg border border-border bg-card transition-colors duration-300 hover:border-primary/50">
			<button
				type="button"
				onClick={copy}
				aria-label={copied ? 'Copied' : 'Copy code'}
				className="absolute right-3 top-3 rounded-md border border-border bg-background p-2 opacity-0 transition-all duration-300 hover:scale-110 group-hover:opacity-100"
			>
				{copied ? (
					<Check className="h-4 w-4 text-primary" aria-hidden="true" />
				) : (
					<Copy className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
				)}
			</button>
			<pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-muted-foreground" dir="ltr">
				<code>{code}</code>
			</pre>
		</div>
	);
}
