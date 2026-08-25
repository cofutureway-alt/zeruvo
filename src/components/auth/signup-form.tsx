'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/client';

export function SignupForm() {
	const t = useTranslations('auth');
	const router = useRouter();
	const locale = useLocale();
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [confirm, setConfirm] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function onSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (password !== confirm) {
			setError(t('passwordMismatch'));
			return;
		}
		setBusy(true);
		setError(null);
		const supabase = createClient();
		const { error: err } = await supabase.auth.signUp({ email, password });
		if (err) {
			setError(err.message.includes('already') ? t('emailInUse') : err.message);
			setBusy(false);
			return;
		}
		// Email confirmation disabled in dev → session may exist immediately.
		router.replace(`/${locale}/dashboard`);
		router.refresh();
	}

	return (
		<form onSubmit={onSubmit} className="space-y-4">
			<label className="block">
				<span className="text-sm text-[var(--nx-muted)]">{t('email')}</span>
				<input
					type="email"
					required
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					className="mt-1 w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--nx-accent)]"
				/>
			</label>
			<label className="block">
				<span className="text-sm text-[var(--nx-muted)]">{t('password')}</span>
				<input
					type="password"
					required
					minLength={8}
					value={password}
					onChange={(e) => setPassword(e.target.value)}
					className="mt-1 w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--nx-accent)]"
				/>
			</label>
			<label className="block">
				<span className="text-sm text-[var(--nx-muted)]">{t('confirmPassword')}</span>
				<input
					type="password"
					required
					minLength={8}
					value={confirm}
					onChange={(e) => setConfirm(e.target.value)}
					className="mt-1 w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--nx-accent)]"
				/>
			</label>
			{error && <p className="text-sm text-[var(--nx-danger)]">{error}</p>}
			<button
				type="submit"
				disabled={busy}
				className="w-full rounded-lg bg-[var(--nx-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--nx-accent-strong)] disabled:opacity-50"
			>
				{t('signupAction')}
			</button>
		</form>
	);
}
