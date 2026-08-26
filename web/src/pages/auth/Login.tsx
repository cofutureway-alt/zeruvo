import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';

export default function Login() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const location = useLocation();
	const next = (location.state as { next?: string } | null)?.next ?? '/dashboard';
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function onSubmit(e: React.FormEvent) {
		e.preventDefault();
		setBusy(true);
		setError(null);
		const { error: err } = await supabase.auth.signInWithPassword({ email, password });
		if (err) {
			setError(err.message.includes('Invalid login') ? t('auth.invalidCredentials') : err.message);
			setBusy(false);
			return;
		}
		navigate(next, { replace: true });
	}

	return (
		<main className="grid min-h-dvh place-items-center bg-[var(--nx-bg)] px-4">
			<section className="w-full max-w-sm rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-8">
				<h1 className="text-xl font-semibold tracking-tight">{t('auth.loginTitle')}</h1>
				<p className="mt-1 text-sm text-[var(--nx-muted)]">{t('auth.loginSubtitle')}</p>
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
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							className="mt-1 w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-500"
						/>
					</label>
					{error && <p className="text-sm text-red-400">{error}</p>}
					<button
						type="submit"
						disabled={busy}
						className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
					>
						{t('auth.loginAction')}
					</button>
				</form>
				<p className="mt-5 text-center text-xs text-[var(--nx-muted)]">
					{t('auth.noAccount')}{' '}
					<Link to="/signup" className="text-indigo-400 hover:text-indigo-300">
						{t('nav.signup')}
					</Link>
				</p>
			</section>
		</main>
	);
}
