'use client';

import Link from 'next/link';
import { useState } from 'react';

const t = {
	en: { models: 'Models', pricing: 'Pricing', docs: 'Docs', login: 'Log in', signup: 'Sign up' },
	ar: { models: 'الموديلات', pricing: 'الأسعار', docs: 'التوثيق', login: 'دخول', signup: 'حساب جديد' },
	fr: { models: 'Modèles', pricing: 'Tarifs', docs: 'Docs', login: 'Connexion', signup: "S'inscrire" },
	zh: { models: '模型', pricing: '价格', docs: '文档', login: '登录', signup: '注册' },
} as const;

export function SiteHeader({ locale }: { locale: string }) {
	const tr = t[locale as keyof typeof t] ?? t.en;
	const [open, setOpen] = useState(false);

	const links = [
		{ href: `/${locale}/models`, label: tr.models },
		{ href: `/${locale}/pricing`, label: tr.pricing },
		{ href: `/${locale}/docs`, label: tr.docs },
	];

	return (
		<header className="sticky top-0 z-40 border-b border-[var(--nx-border)] bg-[var(--nx-bg)]/85 backdrop-blur">
			<div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
				<Link href={`/${locale}`} className="flex items-center gap-2.5">
					<span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-bold text-white">
						N
					</span>
					<span className="font-semibold tracking-tight">Nexor AI</span>
				</Link>

				<nav className="hidden items-center gap-7 text-sm md:flex">
					{links.map((l) => (
						<Link key={l.href} href={l.href} className="text-[var(--nx-muted)] transition hover:text-zinc-100">
							{l.label}
						</Link>
					))}
				</nav>

				<div className="hidden items-center gap-3 md:flex">
					<Link href={`/${locale}/login`} className="rounded-lg px-4 py-2 text-sm text-[var(--nx-muted)] transition hover:text-zinc-100">
						{tr.login}
					</Link>
					<Link
						href={`/${locale}/signup`}
						className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500"
					>
						{tr.signup}
					</Link>
				</div>

				<button onClick={() => setOpen((o) => !o)} className="grid size-9 place-items-center md:hidden" aria-label="Menu">
					<span className="space-y-1.5">
						<span className="block h-0.5 w-5 bg-current" />
						<span className="block h-0.5 w-5 bg-current" />
						<span className="block h-0.5 w-5 bg-current" />
					</span>
				</button>
			</div>
			{open && (
				<nav className="border-t border-[var(--nx-border)] px-6 py-3 md:hidden">
					{links.map((l) => (
						<Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="block py-2 text-sm text-[var(--nx-muted)]">
							{l.label}
						</Link>
					))}
					<div className="mt-2 flex gap-2">
						<Link href={`/${locale}/login`} className="flex-1 rounded-lg border border-[var(--nx-border)] py-2 text-center text-sm">
							{tr.login}
						</Link>
						<Link href={`/${locale}/signup`} className="flex-1 rounded-lg bg-indigo-600 py-2 text-center text-sm font-medium text-white">
							{tr.signup}
						</Link>
					</div>
				</nav>
			)}
		</header>
	);
}
