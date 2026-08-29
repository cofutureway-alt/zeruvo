import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Check, AlertTriangle, Loader2, ExternalLink } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { GithubIcon } from '../../components/GithubIcon';
import { DashboardShell } from '../../components/DashboardShell';
import { edgeCall } from '../../lib/admin-api';

type SignupMode = 'email_and_github' | 'github_only' | 'disabled';

interface SettingsRow {
	signup_mode: SignupMode;
	github_min_age_days: number;
}

const MODES: Array<{ value: SignupMode; label: string; hint: string }> = [
	{ value: 'email_and_github', label: 'Email + GitHub', hint: 'New users can sign up with either method.' },
	{ value: 'github_only', label: 'GitHub only', hint: 'New signups require GitHub. Existing email users can still log in.' },
	{ value: 'disabled', label: 'Closed', hint: 'No new signups at all. Existing users (email & GitHub) keep access.' },
];

/** Admin signup/auth controls backed by the app_settings singleton (id=1). */
export default function AdminSettings() {
	const [email, setEmail] = useState('');
	const [mode, setMode] = useState<SignupMode>('email_and_github');
	const [minAge, setMinAge] = useState(0);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
	// GitHub OAuth app credentials
	const [ghClientId, setGhClientId] = useState('');
	const [ghSecret, setGhSecret] = useState('');
	const [ghStatus, setGhStatus] = useState<{ enabled: boolean; client_id: string; has_secret: boolean } | null>(null);
	const [ghSaving, setGhSaving] = useState(false);
	const [ghMessage, setGhMessage] = useState<{ ok: boolean; text: string } | null>(null);

	const load = useCallback(async () => {
		const { data: { user } } = await supabase.auth.getUser();
		setEmail(user?.email ?? '');
		const [{ data }, ghRes] = await Promise.all([
			supabase
				.from('app_settings')
				.select('signup_mode, github_min_age_days')
				.eq('id', 1)
				.maybeSingle(),
			edgeCall<{ enabled: boolean; client_id: string; has_secret: boolean }>('admin-auth-settings', { action: 'status' }).catch(() => null),
		]);
		if (data) {
			setMode(data.signup_mode as SignupMode);
			setMinAge(data.github_min_age_days ?? 0);
		}
		if (ghRes) setGhStatus(ghRes);
		setLoading(false);
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	async function save() {
		setSaving(true);
		setMessage(null);
		const { error } = await supabase
			.from('app_settings')
			.update({ signup_mode: mode, github_min_age_days: Math.max(0, Math.floor(minAge) || 0), updated_at: new Date().toISOString() })
			.eq('id', 1);
		if (error) setMessage({ ok: false, text: error.message });
		else setMessage({ ok: true, text: 'Signup settings saved.' });
		setSaving(false);
	}

	async function saveGithub() {
		if (!ghClientId.trim() || !ghSecret.trim()) {
			setGhMessage({ ok: false, text: 'Client ID and Client Secret are both required.' });
			return;
		}
		setGhSaving(true);
		setGhMessage(null);
		const res = await edgeCall<{ ok?: boolean; error?: string }>('admin-auth-settings', {
			action: 'save',
			client_id: ghClientId.trim(),
			client_secret: ghSecret.trim(),
		});
		if (res?.error) setGhMessage({ ok: false, text: res.error });
		else {
			setGhMessage({ ok: true, text: 'GitHub OAuth connected — sign-in is live.' });
			setGhSecret('');
			await load();
		}
		setGhSaving(false);
	}

	async function disconnectGithub() {
		setGhSaving(true);
		setGhMessage(null);
		const res = await edgeCall<{ ok?: boolean; error?: string }>('admin-auth-settings', { action: 'clear' });
		if (res?.error) setGhMessage({ ok: false, text: res.error });
		else {
			setGhMessage({ ok: true, text: 'GitHub OAuth disconnected.' });
			setGhClientId('');
			setGhSecret('');
			await load();
		}
		setGhSaving(false);
	}

	return (
		<DashboardShell variant="admin" email={email}>
			<div className="mx-auto max-w-3xl space-y-6">
				<header>
					<h1 className="text-xl font-semibold tracking-tight">Signup & Auth</h1>
					<p className="mt-0.5 text-sm text-[var(--nx-muted)]">
						Control how new accounts are created. Existing users always keep access.
					</p>
				</header>

				{loading ? (
					<div className="nx-skeleton h-64 rounded-xl" aria-busy="true" />
				) : (
					<section className="space-y-5 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-6">
						<div className="flex items-center gap-3">
							<div className="grid size-10 place-items-center rounded-xl bg-cyan-500/10">
								<ShieldCheck size={20} className="text-cyan-400" />
							</div>
							<div>
								<p className="font-medium">Signup mode</p>
								<p className="text-xs text-[var(--nx-muted)]">Applies to new registrations only.</p>
							</div>
						</div>

						<div className="grid gap-2">
							{MODES.map((m) => (
								<button
									key={m.value}
									onClick={() => setMode(m.value)}
									className={`flex flex-col items-start rounded-xl border px-4 py-3 text-start transition ${
										mode === m.value
											? 'border-cyan-500 bg-cyan-500/10'
											: 'border-[var(--nx-border)] hover:border-zinc-600'
									}`}
								>
									<span className={`text-sm font-medium ${mode === m.value ? 'text-cyan-300' : ''}`}>{m.label}</span>
									<span className="mt-0.5 text-xs text-[var(--nx-muted)]">{m.hint}</span>
								</button>
							))}
						</div>

						<label className="block">
							<span className="text-sm text-[var(--nx-muted)]">
								Minimum GitHub account age (days)
							</span>
							<p className="mb-1 text-xs text-[var(--nx-muted)]">
								A GitHub account younger than this is held on a "pending" page until it reaches the age. 0 disables the check.
							</p>
							<input
								type="number"
								min={0}
								value={minAge}
								onChange={(e) => setMinAge(Number(e.target.value) || 0)}
								className="mt-1 w-32 rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 font-mono text-sm tabular-nums outline-none focus:border-cyan-500"
							/>
						</label>

						{message && (
							<p className={`flex items-center gap-2 text-sm ${message.ok ? 'text-emerald-400' : 'text-red-400'}`}>
								{message.ok ? <Check size={15} /> : <AlertTriangle size={15} />}
								{message.text}
							</p>
						)}

						<button
							onClick={save}
							disabled={saving}
							className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-40"
						>
							{saving && <Loader2 size={14} className="animate-spin" />}
							Save settings
						</button>
					</section>
				)}

				<section className="rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-6">
					<div className="flex items-center gap-3">
						<div className="grid size-10 place-items-center rounded-xl bg-zinc-800/60">
							<GithubIcon size={20} />
						</div>
						<div className="flex-1">
							<p className="font-medium">GitHub OAuth connection</p>
							<p className="text-xs text-[var(--nx-muted)]">
								Paste your GitHub OAuth App credentials here — they are applied to Supabase Auth instantly. No dashboard needed.
							</p>
						</div>
						{ghStatus && (
							<span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] ${ghStatus.enabled ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-700/40 text-zinc-400'}`}>
								{ghStatus.enabled ? 'Connected' : 'Not connected'}
							</span>
						)}
					</div>

					<ol className="mt-4 list-decimal space-y-1.5 ps-5 text-xs leading-relaxed text-[var(--nx-muted)]">
						<li>
							On GitHub, open <strong>Settings → Developer settings → OAuth Apps → New OAuth App</strong>{' '}
							<a href="https://github.com/settings/developers" target="_blank" rel="noreferrer" className="ms-1 inline-flex items-center gap-0.5 text-cyan-400 hover:text-cyan-300">
								github.com/settings/developers <ExternalLink size={10} />
							</a>
						</li>
						<li>
							Application name: anything (e.g. <em>Zeruvo AI</em>). Homepage URL:{' '}
							<code className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300">https://zeruvo.online</code>
						</li>
						<li>
							Authorization callback URL — copy exactly:{' '}
							<code className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300">
								https://unacmcjzwxoyerllvdmt.supabase.co/auth/v1/callback
							</code>
						</li>
						<li>Register, then copy the <strong>Client ID</strong> and click "Generate a new client secret" for the <strong>Client Secret</strong>.</li>
						<li>Paste both below and save — GitHub sign-in goes live immediately.</li>
					</ol>

					<div className="mt-5 space-y-3">
						<label className="block">
							<span className="text-sm text-[var(--nx-muted)]">Client ID</span>
							<input
								value={ghClientId}
								onChange={(e) => setGhClientId(e.target.value)}
								placeholder={ghStatus?.client_id || 'Iv1.xxxxxxxxxxxx'}
								dir="ltr"
								className="mt-1 w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-cyan-500"
							/>
						</label>
						<label className="block">
							<span className="text-sm text-[var(--nx-muted)]">
								Client Secret
								{ghStatus?.has_secret && <span className="ms-2 text-emerald-400">•••••••• stored</span>}
							</span>
							<input
								type="password"
								value={ghSecret}
								onChange={(e) => setGhSecret(e.target.value)}
								placeholder={ghStatus?.has_secret ? 'Leave blank to keep current' : 'Paste your client secret'}
								dir="ltr"
								className="mt-1 w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-cyan-500"
							/>
						</label>

						{ghMessage && (
							<p className={`flex items-center gap-2 text-sm ${ghMessage.ok ? 'text-emerald-400' : 'text-red-400'}`}>
								{ghMessage.ok ? <Check size={15} /> : <AlertTriangle size={15} />}
								{ghMessage.text}
							</p>
						)}

						<div className="flex gap-2">
							<button
								onClick={saveGithub}
								disabled={ghSaving}
								className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-cyan-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-40"
							>
								{ghSaving && <Loader2 size={14} className="animate-spin" />}
								Connect GitHub OAuth
							</button>
							{ghStatus?.enabled && (
								<button
									onClick={disconnectGithub}
									disabled={ghSaving}
									className="rounded-lg border border-red-500/40 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-40"
								>
									Disconnect
								</button>
							)}
						</div>
					</div>
				</section>
			</div>
		</DashboardShell>
	);
}
