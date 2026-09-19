import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Check, AlertTriangle, Loader2, ExternalLink, KeyRound, Wallet, Sparkles } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { GithubIcon } from '../../components/GithubIcon';
import { DashboardShell } from '../../components/DashboardShell';
import { edgeCall } from '../../lib/admin-api';
import { invalidateAppSettings } from '../../hooks/useAppSettings';

type SignupMode = 'email_and_github' | 'github_only' | 'disabled';
type Tab = 'signup' | 'google' | 'turnstile' | 'wallet';

interface StatusAll {
	github: { enabled: boolean; client_id: string; has_secret: boolean };
	google: { enabled: boolean; firebase_config: Record<string, string>; third_party_enabled: boolean };
	turnstile: { enabled: boolean; site_key: string; on_login: boolean; on_api_key: boolean };
	signup_mode: string;
}

const MODES: Array<{ value: SignupMode; label: string; hint: string }> = [
	{ value: 'email_and_github', label: 'Email + GitHub', hint: 'New users can sign up with either method.' },
	{ value: 'github_only', label: 'GitHub only', hint: 'New signups require GitHub. Existing email users can still log in.' },
	{ value: 'disabled', label: 'Closed', hint: 'No new signups at all. Existing users (email & GitHub) keep access.' },
];

const TABS: Array<{ key: Tab; label: string; icon: typeof ShieldCheck }> = [
	{ key: 'signup', label: 'Signup & GitHub', icon: ShieldCheck },
	{ key: 'google', label: 'Google (Firebase)', icon: Sparkles },
	{ key: 'turnstile', label: 'Turnstile', icon: KeyRound },
	{ key: 'wallet', label: 'Wallet', icon: Wallet },
];

export default function AdminSettings() {
	const [email, setEmail] = useState('');
	const [tab, setTab] = useState<Tab>('signup');
	const [status, setStatus] = useState<StatusAll | null>(null);
	const [mode, setMode] = useState<SignupMode>('email_and_github');
	const [minAge, setMinAge] = useState(0);
	const [saving, setSaving] = useState(false);
	const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

	// GitHub
	const [ghClientId, setGhClientId] = useState('');
	const [ghSecret, setGhSecret] = useState('');
	const [ghSaving, setGhSaving] = useState(false);
	const [ghMessage, setGhMessage] = useState<{ ok: boolean; text: string } | null>(null);

	// Firebase
	const [fb, setFb] = useState({ apiKey: '', authDomain: '', projectId: '', storageBucket: '', messagingSenderId: '', appId: '' });
	const [fbSaving, setFbSaving] = useState(false);
	const [fbMessage, setFbMessage] = useState<{ ok: boolean; text: string } | null>(null);

	// Turnstile
	const [tsSite, setTsSite] = useState('');
	const [tsSecret, setTsSecret] = useState('');
	const [tsOnLogin, setTsOnLogin] = useState(true);
	const [tsOnKey, setTsOnKey] = useState(false);
	const [tsSaving, setTsSaving] = useState(false);
	const [tsMessage, setTsMessage] = useState<{ ok: boolean; text: string } | null>(null);

	// Wallet
	const [walletMin, setWalletMin] = useState(10);
	const [walletMax, setWalletMax] = useState(200);
	const [walletQuick, setWalletQuick] = useState('10, 25, 50, 100, 200');
	const [walletSaving, setWalletSaving] = useState(false);
	const [walletMessage, setWalletMessage] = useState<{ ok: boolean; text: string } | null>(null);

	const load = useCallback(async () => {
		const { data: { user } } = await supabase.auth.getUser();
		setEmail(user?.email ?? '');
		const [{ data }, st] = await Promise.all([
			supabase.from('app_settings').select('*').eq('id', 1).maybeSingle(),
			edgeCall<StatusAll>('admin-auth-settings', { action: 'status' }).catch(() => null),
		]);
		if (data) {
			setMode(data.signup_mode as SignupMode);
			setMinAge(data.github_min_age_days ?? 0);
			setWalletMin(Number(data.wallet_min_topup_usd ?? 10));
			setWalletMax(Number(data.wallet_max_topup_usd ?? 200));
			setWalletQuick((data.wallet_quick_amounts ?? [10, 25, 50, 100, 200]).join(', '));
		}
		if (st) {
			setStatus(st);
			const f = st.google.firebase_config ?? {};
			setFb({
				apiKey: f.apiKey ?? '',
				authDomain: f.authDomain ?? '',
				projectId: f.projectId ?? '',
				storageBucket: f.storageBucket ?? '',
				messagingSenderId: f.messagingSenderId ?? '',
				appId: f.appId ?? '',
			});
			setTsSite(st.turnstile.site_key ?? '');
			setTsOnLogin(st.turnstile.on_login);
			setTsOnKey(st.turnstile.on_api_key);
		}
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

	async function saveFirebase() {
		setFbSaving(true);
		setFbMessage(null);
		const res = await edgeCall<{ ok?: boolean; error?: string }>('admin-auth-settings', { action: 'save_firebase', ...fb });
		if (res?.error) setFbMessage({ ok: false, text: res.error });
		else {
			setFbMessage({ ok: true, text: 'Google sign-in via Firebase is live.' });
			invalidateAppSettings();
			await load();
		}
		setFbSaving(false);
	}

	async function clearFirebase() {
		setFbSaving(true);
		setFbMessage(null);
		const res = await edgeCall<{ ok?: boolean; error?: string }>('admin-auth-settings', { action: 'clear_firebase' });
		if (res?.error) setFbMessage({ ok: false, text: res.error });
		else {
			setFbMessage({ ok: true, text: 'Google sign-in disabled.' });
			invalidateAppSettings();
			await load();
		}
		setFbSaving(false);
	}

	async function saveTurnstile() {
		if (!tsSite.trim() || !tsSecret.trim()) {
			setTsMessage({ ok: false, text: 'Site key and secret key are both required.' });
			return;
		}
		setTsSaving(true);
		setTsMessage(null);
		const res = await edgeCall<{ ok?: boolean; error?: string }>('admin-auth-settings', {
			action: 'save_turnstile',
			site_key: tsSite.trim(),
			secret_key: tsSecret.trim(),
			on_login: tsOnLogin,
			on_api_key: tsOnKey,
		});
		if (res?.error) setTsMessage({ ok: false, text: res.error });
		else {
			setTsMessage({ ok: true, text: 'Turnstile is live — secrets applied instantly.' });
			setTsSecret('');
			invalidateAppSettings();
			await load();
		}
		setTsSaving(false);
	}

	async function clearTurnstile() {
		setTsSaving(true);
		setTsMessage(null);
		const res = await edgeCall<{ ok?: boolean; error?: string }>('admin-auth-settings', { action: 'clear_turnstile' });
		if (res?.error) setTsMessage({ ok: false, text: res.error });
		else {
			setTsMessage({ ok: true, text: 'Turnstile disabled.' });
			invalidateAppSettings();
			await load();
		}
		setTsSaving(false);
	}

	async function saveWallet() {
		setWalletSaving(true);
		setWalletMessage(null);
		const quick = walletQuick.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
		if (quick.length === 0 || walletMin <= 0 || walletMax < walletMin) {
			setWalletMessage({ ok: false, text: 'Check the bounds — min must be positive and max ≥ min.' });
			setWalletSaving(false);
			return;
		}
		const { error } = await supabase.from('app_settings').update({
			wallet_min_topup_usd: walletMin,
			wallet_max_topup_usd: walletMax,
			wallet_quick_amounts: quick,
		}).eq('id', 1);
		if (error) setWalletMessage({ ok: false, text: error.message });
		else {
			setWalletMessage({ ok: true, text: 'Wallet bounds saved.' });
			invalidateAppSettings();
		}
		setWalletSaving(false);
	}

	return (
		<DashboardShell variant="admin" email={email}>
			<div className="mx-auto max-w-3xl space-y-6">
				<header>
					<h1 className="text-xl font-semibold tracking-tight">Settings</h1>
					<p className="mt-0.5 text-sm text-[var(--nx-muted)]">
						Signup, Google sign-in, human verification and wallet bounds.
					</p>
				</header>

				<div className="flex flex-wrap gap-1.5">
					{TABS.map(({ key, label, icon: Icon }) => (
						<button
							key={key}
							onClick={() => setTab(key)}
							className={`flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm transition ${
								tab === key ? 'border-cyan-500/60 bg-cyan-500/10 text-cyan-300' : 'border-border text-muted-foreground hover:border-cyan-500/40'
							}`}
						>
							<Icon size={14} /> {label}
						</button>
					))}
				</div>

				{/* ---------- signup tab ---------- */}
				{tab === 'signup' && (
					<>
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
											mode === m.value ? 'border-cyan-500 bg-cyan-500/10' : 'border-[var(--nx-border)] hover:border-zinc-600'
										}`}
									>
										<span className={`text-sm font-medium ${mode === m.value ? 'text-cyan-300' : ''}`}>{m.label}</span>
										<span className="mt-0.5 text-xs text-[var(--nx-muted)]">{m.hint}</span>
									</button>
								))}
							</div>

							<label className="block">
								<span className="text-sm text-[var(--nx-muted)]">Minimum GitHub account age (days)</span>
								<p className="mb-1 text-xs text-[var(--nx-muted)]">
									A GitHub account younger than this is held on a "pending" page until it reaches the age. 0 disables the check.
								</p>
								<input
									type="number" min={0} value={minAge}
									onChange={(e) => setMinAge(Number(e.target.value) || 0)}
									className="mt-1 w-32 rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 font-mono text-sm tabular-nums outline-none focus:border-cyan-500"
								/>
							</label>

							{message && (
								<p className={`flex items-center gap-2 text-sm ${message.ok ? 'text-emerald-400' : 'text-red-400'}`}>
									{message.ok ? <Check size={15} /> : <AlertTriangle size={15} />}{message.text}
								</p>
							)}

							<button onClick={save} disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-40">
								{saving && <Loader2 size={14} className="animate-spin" />} Save settings
							</button>
						</section>

						<section className="rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-6">
							<div className="flex items-center gap-3">
								<div className="grid size-10 place-items-center rounded-xl bg-zinc-800/60">
									<GithubIcon size={20} />
								</div>
								<div className="flex-1">
									<p className="font-medium">GitHub OAuth connection</p>
									<p className="text-xs text-[var(--nx-muted)]">Credentials are applied to Supabase Auth instantly — no dashboard needed.</p>
								</div>
								{status?.github && (
									<span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] ${status.github.enabled ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-700/40 text-zinc-400'}`}>
										{status.github.enabled ? 'Connected' : 'Not connected'}
									</span>
								)}
							</div>

							<ol className="mt-4 list-decimal space-y-1.5 ps-5 text-xs leading-relaxed text-[var(--nx-muted)]">
								<li>
									On GitHub open <strong>Settings → Developer settings → OAuth Apps → New OAuth App</strong>{' '}
									<a href="https://github.com/settings/developers" target="_blank" rel="noreferrer" className="ms-1 inline-flex items-center gap-0.5 text-cyan-400 hover:text-cyan-300">
										github.com/settings/developers <ExternalLink size={10} />
									</a>
								</li>
								<li>Authorization callback URL — copy exactly: <code className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300">https://unacmcjzwxoyerllvdmt.supabase.co/auth/v1/callback</code></li>
								<li>Paste the Client ID + Client Secret below and connect.</li>
							</ol>

							<div className="mt-5 space-y-3">
								<label className="block">
									<span className="text-sm text-[var(--nx-muted)]">Client ID</span>
									<input value={ghClientId} onChange={(e) => setGhClientId(e.target.value)} placeholder={status?.github?.client_id || 'Iv1.xxxxxxxxxxxx'} dir="ltr"
										className="mt-1 w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-cyan-500" />
								</label>
								<label className="block">
									<span className="text-sm text-[var(--nx-muted)]">
										Client Secret{status?.github?.has_secret && <span className="ms-2 text-emerald-400">•••••••• stored</span>}
									</span>
									<input type="password" value={ghSecret} onChange={(e) => setGhSecret(e.target.value)} dir="ltr"
										className="mt-1 w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-cyan-500" />
								</label>

								{ghMessage && (
									<p className={`flex items-center gap-2 text-sm ${ghMessage.ok ? 'text-emerald-400' : 'text-red-400'}`}>
										{ghMessage.ok ? <Check size={15} /> : <AlertTriangle size={15} />}{ghMessage.text}
									</p>
								)}

								<div className="flex gap-2">
									<button onClick={saveGithub} disabled={ghSaving} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-cyan-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-40">
										{ghSaving && <Loader2 size={14} className="animate-spin" />} Connect GitHub OAuth
									</button>
									{status?.github?.enabled && (
										<button onClick={disconnectGithub} disabled={ghSaving} className="rounded-lg border border-red-500/40 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-40">
											Disconnect
										</button>
									)}
								</div>
							</div>
						</section>
					</>
				)}

				{/* ---------- google via firebase tab ---------- */}
				{tab === 'google' && (
					<section className="space-y-5 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-6">
						<div className="flex items-center gap-3">
							<div className="grid size-10 place-items-center rounded-xl bg-violet-500/10">
								<Sparkles size={20} className="text-violet-400" />
							</div>
							<div className="flex-1">
								<p className="font-medium">Google sign-in via Firebase</p>
								<p className="text-xs text-[var(--nx-muted)]">
									Paste your Firebase web-app config. The public values are stored in app_settings; Supabase is told to accept
									this Firebase project's ID tokens instantly.
								</p>
							</div>
							{status?.google && (
								<span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] ${status.google.enabled ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-700/40 text-zinc-400'}`}>
									{status.google.enabled ? 'Enabled' : 'Disabled'}
								</span>
							)}
						</div>

						<ol className="list-decimal space-y-1.5 ps-5 text-xs leading-relaxed text-[var(--nx-muted)]">
							<li>In the Firebase console create/select a project → <strong>Project settings → Your apps → Web app</strong>.</li>
							<li>Enable <strong>Authentication → Sign-in method → Google</strong>.</li>
							<li>
								Add your site to <strong>Authorized domains</strong> (e.g. <code className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px]">zeruvo.online</code>).
							</li>
							<li>Paste the web config values below (apiKey, authDomain, projectId, appId required).</li>
						</ol>

						<div className="grid gap-3 sm:grid-cols-2">
							{([
								['apiKey', 'API key', 'AIzaSy…'],
								['authDomain', 'Auth domain', 'my-app.firebaseapp.com'],
								['projectId', 'Project ID', 'my-app'],
								['appId', 'App ID', '1:123:web:abc'],
								['storageBucket', 'Storage bucket (optional)', 'my-app.appspot.com'],
								['messagingSenderId', 'Messaging sender ID (optional)', '123456789'],
							] as const).map(([key, label, ph]) => (
								<label key={key} className="block">
									<span className="text-sm text-[var(--nx-muted)]">{label}</span>
									<input
										value={fb[key]}
										onChange={(e) => setFb({ ...fb, [key]: e.target.value })}
										placeholder={ph}
										dir="ltr"
										className="mt-1 w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 font-mono text-xs outline-none focus:border-cyan-500"
									/>
								</label>
							))}
						</div>

						{fbMessage && (
							<p className={`flex items-center gap-2 text-sm ${fbMessage.ok ? 'text-emerald-400' : 'text-red-400'}`}>
								{fbMessage.ok ? <Check size={15} /> : <AlertTriangle size={15} />}{fbMessage.text}
							</p>
						)}

						<div className="flex gap-2">
							<button onClick={saveFirebase} disabled={fbSaving} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-cyan-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-40">
								{fbSaving && <Loader2 size={14} className="animate-spin" />} Enable Google sign-in
							</button>
							{status?.google?.enabled && (
								<button onClick={clearFirebase} disabled={fbSaving} className="rounded-lg border border-red-500/40 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-40">
									Disable
								</button>
							)}
						</div>
					</section>
				)}

				{/* ---------- turnstile tab ---------- */}
				{tab === 'turnstile' && (
					<section className="space-y-5 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-6">
						<div className="flex items-center gap-3">
							<div className="grid size-10 place-items-center rounded-xl bg-cyan-500/10">
								<KeyRound size={20} className="text-cyan-400" />
							</div>
							<div className="flex-1">
								<p className="font-medium">Cloudflare Turnstile</p>
								<p className="text-xs text-[var(--nx-muted)]">
									Human verification on login/signup and API-key creation. The secret is encrypted at rest and applied to
									Supabase auth captcha instantly.
								</p>
							</div>
							{status?.turnstile && (
								<span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] ${status.turnstile.enabled ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-700/40 text-zinc-400'}`}>
									{status.turnstile.enabled ? 'Enabled' : 'Disabled'}
								</span>
							)}
						</div>

						<ol className="list-decimal space-y-1.5 ps-5 text-xs leading-relaxed text-[var(--nx-muted)]">
							<li>In Cloudflare open <strong>Turnstile → Add site</strong>{' '}
								<a href="https://dash.cloudflare.com/?to=/:account/turnstile" target="_blank" rel="noreferrer" className="ms-1 inline-flex items-center gap-0.5 text-cyan-400 hover:text-cyan-300">
									dash.cloudflare.com <ExternalLink size={10} />
								</a>
							</li>
							<li>Add your domains (zeruvo.online + localhost for testing) and choose <em>Managed</em> mode.</li>
							<li>Paste the Site Key + Secret Key below.</li>
						</ol>

						<label className="block">
							<span className="text-sm text-[var(--nx-muted)]">Site key</span>
							<input value={tsSite} onChange={(e) => setTsSite(e.target.value)} placeholder="0x…" dir="ltr"
								className="mt-1 w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-cyan-500" />
						</label>
						<label className="block">
							<span className="text-sm text-[var(--nx-muted)]">Secret key</span>
							<input type="password" value={tsSecret} onChange={(e) => setTsSecret(e.target.value)} placeholder={status?.turnstile?.enabled ? 'Leave blank to keep current' : '0x…'} dir="ltr"
								className="mt-1 w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-cyan-500" />
						</label>

						<div className="space-y-2">
							<label className="flex items-center gap-2 text-sm">
								<input type="checkbox" checked={tsOnLogin} onChange={(e) => setTsOnLogin(e.target.checked)} className="accent-cyan-500" />
								Require on login / signup
							</label>
							<label className="flex items-center gap-2 text-sm">
								<input type="checkbox" checked={tsOnKey} onChange={(e) => setTsOnKey(e.target.checked)} className="accent-cyan-500" />
								Require when creating a new API key
							</label>
						</div>

						{tsMessage && (
							<p className={`flex items-center gap-2 text-sm ${tsMessage.ok ? 'text-emerald-400' : 'text-red-400'}`}>
								{tsMessage.ok ? <Check size={15} /> : <AlertTriangle size={15} />}{tsMessage.text}
							</p>
						)}

						<div className="flex gap-2">
							<button onClick={saveTurnstile} disabled={tsSaving} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-cyan-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-40">
								{tsSaving && <Loader2 size={14} className="animate-spin" />} Enable Turnstile
							</button>
							{status?.turnstile?.enabled && (
								<button onClick={clearTurnstile} disabled={tsSaving} className="rounded-lg border border-red-500/40 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-40">
									Disable
								</button>
							)}
						</div>
					</section>
				)}

				{/* ---------- wallet tab ---------- */}
				{tab === 'wallet' && (
					<section className="space-y-5 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-6">
						<div className="flex items-center gap-3">
							<div className="grid size-10 place-items-center rounded-xl bg-emerald-500/10">
								<Wallet size={20} className="text-emerald-400" />
							</div>
							<div>
								<p className="font-medium">Wallet bounds</p>
								<p className="text-xs text-[var(--nx-muted)]">Top-up limits and the quick-select chips shown to users.</p>
							</div>
						</div>

						<div className="grid gap-3 sm:grid-cols-2">
							<label className="block">
								<span className="text-sm text-[var(--nx-muted)]">Minimum top-up (USD)</span>
								<input type="number" min={1} value={walletMin} onChange={(e) => setWalletMin(Number(e.target.value) || 0)}
									className="mt-1 w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 font-data text-sm tabular-nums outline-none focus:border-cyan-500" />
							</label>
							<label className="block">
								<span className="text-sm text-[var(--nx-muted)]">Maximum top-up (USD)</span>
								<input type="number" min={1} value={walletMax} onChange={(e) => setWalletMax(Number(e.target.value) || 0)}
									className="mt-1 w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 font-data text-sm tabular-nums outline-none focus:border-cyan-500" />
							</label>
						</div>
						<label className="block">
							<span className="text-sm text-[var(--nx-muted)]">Quick-select amounts (comma separated)</span>
							<input value={walletQuick} onChange={(e) => setWalletQuick(e.target.value)} dir="ltr"
								className="mt-1 w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 font-data text-sm outline-none focus:border-cyan-500" />
						</label>

						{walletMessage && (
							<p className={`flex items-center gap-2 text-sm ${walletMessage.ok ? 'text-emerald-400' : 'text-red-400'}`}>
								{walletMessage.ok ? <Check size={15} /> : <AlertTriangle size={15} />}{walletMessage.text}
							</p>
						)}

						<button onClick={saveWallet} disabled={walletSaving} className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-40">
							{walletSaving && <Loader2 size={14} className="animate-spin" />} Save wallet bounds
						</button>
					</section>
				)}
			</div>
		</DashboardShell>
	);
}
