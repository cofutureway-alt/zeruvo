import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { DashboardShell } from '../../components/DashboardShell';
import { locales, setLocale, type Locale } from '../../i18n-config';
import { Trash2 } from 'lucide-react';

const labels: Record<Locale, string> = { en: 'English', ar: 'العربية', fr: 'Français', zh: '中文' };

export default function Settings() {
	const { t, i18n } = useTranslation();
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [confirm, setConfirm] = useState('');
	const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
	const [busy, setBusy] = useState(false);
	const [deleting, setDeleting] = useState(false);

	useEffect(() => {
		void supabase.auth.getUser().then(({ data: { user } }) => setEmail(user?.email ?? ''));
	}, []);

	async function deleteAccount() {
		const confirmed = window.confirm(
			'Delete your account permanently? All data — profile, API keys, usage logs, subscriptions, and billing records — will be removed. This cannot be undone.',
		);
		if (!confirmed) return;

		setDeleting(true);
		setMessage(null);
		const { data: { session } } = await supabase.auth.getSession();
		const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-account`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
		});
		const json = await res.json().catch(() => ({}));
		if (!res.ok) {
			setMessage({ ok: false, text: json.error ?? 'Failed to delete account' });
		} else {
			setMessage({ ok: true, text: 'Account deleted. You will be signed out.' });
			await supabase.auth.signOut();
			window.location.href = '/login';
		}
		setDeleting(false);
	}

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
										? 'border-cyan-500 bg-cyan-500/10 text-cyan-300'
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
							className="w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-cyan-500"
						/>
						<input
							type="password"
							value={confirm}
							onChange={(e) => setConfirm(e.target.value)}
							placeholder="Confirm new password"
							className="w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-cyan-500"
						/>
						{message && <p className={`text-sm ${message.ok ? 'text-emerald-400' : 'text-red-400'}`}>{message.text}</p>}
						<button
							onClick={changePassword}
							disabled={busy}
							className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-40"
						>
							Update password
						</button>
					</div>
				</section>

					<section className="rounded-xl border border-red-500/30 bg-red-500/5 p-5">
						<h2 className="text-sm font-medium text-red-400">Danger Zone</h2>
						<p className="mt-1 text-xs text-[var(--nx-muted)]">
							Permanently delete your account and all associated data. This action cannot be undone.
						</p>
						<button
							onClick={deleteAccount}
							disabled={deleting || busy}
							className="mt-3 flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-40"
						>
							<Trash2 size={15} />
							{deleting ? 'Deleting…' : 'Delete Account Permanently'}
						</button>
					</section>
			</div>
		</DashboardShell>
	);
}
