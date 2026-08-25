'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { createBrowserClient } from '@supabase/ssr';
import { locales, type Locale } from '@/i18n/config';

const labels: Record<Locale, string> = {
	en: 'English',
	ar: 'العربية',
	fr: 'Français',
	zh: '中文',
};

export function SettingsClient() {
	const t = useTranslations('auth');
	const locale = useLocale();
	const router = useRouter();
	const [password, setPassword] = useState('');
	const [confirm, setConfirm] = useState('');
	const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
	const [busy, setBusy] = useState(false);

	async function changePassword() {
		if (password.length < 8) {
			setMessage({ ok: false, text: 'Password must be at least 8 characters.' });
			return;
		}
		if (password !== confirm) {
			setMessage({ ok: false, text: 'Passwords do not match.' });
			return;
		}
		setBusy(true);
		setMessage(null);
		const supabase = createBrowserClient(
			process.env.NEXT_PUBLIC_SUPABASE_URL!,
			process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
		);
		const { error } = await supabase.auth.updateUser({ password });
		if (error) setMessage({ ok: false, text: error.message });
		else {
			setMessage({ ok: true, text: 'Password updated.' });
			setPassword('');
			setConfirm('');
		}
		setBusy(false);
	}

	function switchLocale(next: Locale) {
		document.cookie = `NEXT_LOCALE=${next}; path=/; max-age=31536000`;
		window.location.pathname = window.location.pathname.replace(/^\/[^/]+/, `/${next}`);
	}

	return (
		<div className="max-w-xl space-y-6">
			<header>
				<h1 className="text-xl font-semibold tracking-tight">Settings</h1>
			</header>

			{/* language */}
			<section className="rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-5">
				<h2 className="text-sm font-medium">Language</h2>
				<div className="mt-3 flex flex-wrap gap-2">
					{locales.map((l) => (
						<button
							key={l}
							onClick={() => switchLocale(l)}
							className={`rounded-lg border px-4 py-2 text-sm transition ${
								l === locale
									? 'border-indigo-500 bg-indigo-500/10 text-indigo-300'
									: 'border-[var(--nx-border)] hover:border-zinc-600'
							}`}
						>
							{labels[l]}
						</button>
					))}
				</div>
				{router && null}
			</section>

			{/* password */}
			<section className="rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-5">
				<h2 className="text-sm font-medium">{t('password')}</h2>
				<div className="mt-3 space-y-3">
					<input
						type="password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						placeholder="New password"
						className="w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-500"
					/>
					<input
						type="password"
						value={confirm}
						onChange={(e) => setConfirm(e.target.value)}
						placeholder="Confirm new password"
						className="w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-500"
					/>
					{message && (
						<p className={`text-sm ${message.ok ? 'text-emerald-400' : 'text-red-400'}`}>{message.text}</p>
					)}
					<button
						onClick={changePassword}
						disabled={busy}
						className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
					>
						Update password
					</button>
				</div>
			</section>
		</div>
	);
}
