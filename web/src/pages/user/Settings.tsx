import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { DashboardShell } from '../../components/DashboardShell';
import { locales, setLocale, type Locale } from '../../i18n';

const labels: Record<Locale, string> = { en: 'English', ar: 'العربية', fr: 'Français', zh: '中文' };

export default function Settings() {
	const { t, i18n } = useTranslation();
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [confirm, setConfirm] = useState('');
	const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		void supabase.auth.getUser().then(({ data: { user } }) => setEmail(user?.email ?? ''));
	}, []);

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
		const { error } = await supabase.auth.updateUser({ password });
		if (error) setMessage({ ok: false, text: error.message });
		else {
			setMessage({ ok: true, text: 'Password updated.' });
			setPassword('');
			setConfirm('');
		}
		setBusy(false);
	}

	return (
		<DashboardShell variant="user" email={email}>
			<div className="max-w-xl space-y-6">
				<h1 className="text-xl font-semibold tracking-tight">Settings</h1>

				<section className="rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-5">
					<h2 className="text-sm font-medium">Language</h2>
					<div className="mt-3 flex flex-wrap gap-2">
						{locales.map((l) => (
							<button
								key={l}
								onClick={() => setLocale(l)}
								className={`rounded-lg border px-4 py-2 text-sm transition ${
									l === i18n.language
										? 'border-indigo-500 bg-indigo-500/10 text-indigo-300'
										: 'border-[var(--nx-border)] hover:border-zinc-600'
								}`}
							>
								{labels[l]}
							</button>
						))}
					</div>
				</section>

				<section className="rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-5">
					<h2 className="text-sm font-medium">{t('auth.password')}</h2>
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
						{message && <p className={`text-sm ${message.ok ? 'text-emerald-400' : 'text-red-400'}`}>{message.text}</p>}
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
		</DashboardShell>
	);
}
