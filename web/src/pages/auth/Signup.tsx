import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';

export default function Signup() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [confirm, setConfirm] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function onSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (password !== confirm) {
			setError(t('auth.passwordMismatch'));
			return;
		}
		setBusy(true);
		setError(null);
		const { error: err } = await supabase.auth.signUp({ email, password });
		if (err) {
			setError(err.message.includes('already') ? t('auth.emailInUse') : err.message);
			setBusy(false);
			return;
		}
		navigate('/dashboard', { replace: true });
	}

	return (
		<main className="grid min-h-dvh place-items-center bg-[var(--nx-bg)] px-4">
			<section className="w-full max-w-sm rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-8">
				<h1 className="text-xl font-semibold tracking-tight">{t('auth.signupTitle')}</h1>
				<p className="mt-1 text-sm text-[var(--nx-muted)]">{t('auth.signupSubtitle')}</p>
				<form onSubmit={onSubmit} className="mt-6 space-y-4">
					<label className="block">
						<span className="text-sm text-[var(--nx-muted)]">{t('auth.email')}</span>
						<input
							type="email"
							required
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							className="mt-1 w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-500"
						/>
					</label>
					<label className="block">
						<span className="text-sm text-[var(--nx-muted)]">{t('auth.password')}</span>
						<input
							type="password"
							required
							minLength={8}
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							className="mt-1 w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-500"
						/>
					</label>
					<label className="block">
						<span className="text-sm text-[var(--nx-muted)]">{t('auth.confirmPassword')}</span>
						<input
							type="password"
							required
							minLength={8}
							value={confirm}
							onChange={(e) => setConfirm(e.target.value)}
							className="mt-1 w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-500"
						/>
					</label>
					{error && <p className="text-sm text-red-400">{error}</p>}
					<button
						type="submit"
						disabled={busy}
						className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
					>
						{t('auth.signupAction')}
					</button>
				</form>
				<p className="mt-5 text-center text-xs text-[var(--nx-muted)]">
					{t('auth.haveAccount')}{' '}
					<Link to="/login" className="text-indigo-400 hover:text-indigo-300">
						{t('nav.login')}
					</Link>
				</p>
			</section>
		</main>
	);
}
