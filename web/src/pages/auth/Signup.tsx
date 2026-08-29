import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import { Mail, Lock, Eye, EyeOff, Loader2, ArrowRight, Check } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { GithubIcon } from '../../components/GithubIcon';
import { useAuth } from '../../auth-context';
import AuthLayout from './AuthLayout';

const ease = [0.22, 1, 0.36, 1] as [number, number, number, number];
const field = (reduced: boolean | null, i: number) => ({
	initial: reduced ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 },
	animate: { opacity: 1, y: 0 },
	transition: { duration: 0.4, delay: 0.08 * i, ease },
});

export default function Signup() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const { signupMode } = useAuth();
	const reduced = useReducedMotion();

	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [confirm, setConfirm] = useState('');
	const [showPw, setShowPw] = useState(false);
	const [showConfirm, setShowConfirm] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [done, setDone] = useState(false);
	const anim = !reduced;

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
		setDone(true);
		setTimeout(() => navigate('/dashboard', { replace: true }), 1200);
	}

	async function continueWithGithub() {
		setBusy(true);
		setError(null);
		const { error: err } = await supabase.auth.signInWithOAuth({
			provider: 'github',
			options: { redirectTo: window.location.origin },
		});
		if (err) {
			setError(err.message);
			setBusy(false);
		}
	}

	const signupClosed = signupMode === 'disabled';

	return (
		<AuthLayout>
			<div className="space-y-6">
				<AnimatePresence mode="wait">
					{done ? (
						<motion.div
							key="done"
							initial={{ opacity: 0, scale: 0.9 }}
							animate={{ opacity: 1, scale: 1 }}
							className="flex flex-col items-center gap-3 py-8"
						>
							<div className="grid size-12 place-items-center rounded-full bg-emerald-500/15">
								<Check size={24} className="text-emerald-400" />
							</div>
							<p className="text-sm font-medium text-[var(--nx-text)]">Account created</p>
							<p className="text-xs text-[var(--nx-muted)]">Redirecting to your dashboard...</p>
						</motion.div>
					) : signupClosed ? (
						<motion.div key="closed" exit={{ opacity: 0, scale: 0.96 }}>
							<motion.div {...field(reduced, 0)}>
								<h1 className="text-xl font-semibold tracking-tight">{t('auth.signupTitle')}</h1>
								<p className="mt-4 rounded-lg bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
									{t('auth.signupsDisabled')}
								</p>
							</motion.div>
						</motion.div>
					) : (
						<motion.div key="form" exit={{ opacity: 0, scale: 0.96 }}>
							{/* heading */}
							<motion.div {...field(reduced, 0)}>
								<h1 className="text-xl font-semibold tracking-tight">{t('auth.signupTitle')}</h1>
								<p className="mt-1 text-sm text-[var(--nx-muted)]">{t('auth.signupSubtitle')}</p>
							</motion.div>

							{/* GitHub signup — first in the flow */}
							<motion.div {...field(reduced, 5)} className="mt-6">
								<motion.button
									type="button"
									onClick={continueWithGithub}
									disabled={busy}
									whileHover={anim ? { scale: 1.01 } : undefined}
									whileTap={anim ? { scale: 0.98 } : undefined}
									className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--nx-border)] py-3 text-sm font-medium transition-colors hover:border-zinc-500 hover:bg-white/[0.03] disabled:opacity-50"
								>
									<GithubIcon size={16} />
									{t('auth.continueWithGithub')}
								</motion.button>
								<div className="my-4 flex items-center gap-3 text-[11px] uppercase tracking-wide text-[var(--nx-muted)]">
									<span className="h-px flex-1 bg-[var(--nx-border)]" />
									or
									<span className="h-px flex-1 bg-[var(--nx-border)]" />
								</div>
							</motion.div>

							{/* email signup — hidden entirely in github_only mode */}
							{signupMode !== 'github_only' && (
							<form onSubmit={onSubmit} className="space-y-4">
								{/* email */}
								<motion.div {...field(reduced, 1)}>
									<label className="block">
										<span className="text-xs font-medium uppercase tracking-wide text-[var(--nx-muted)]">{t('auth.email')}</span>
										<div className="relative mt-1.5">
											<Mail size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--nx-muted)]" />
											<input
												type="email"
												required
												autoComplete="email"
												value={email}
												onChange={(e) => setEmail(e.target.value)}
												className="w-full rounded-lg border border-[var(--nx-border)] bg-transparent py-2.5 pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-zinc-600 focus:border-cyan-500"
												placeholder="you@example.com"
											/>
										</div>
									</label>
								</motion.div>

								{/* password */}
								<motion.div {...field(reduced, 2)}>
									<label className="block">
										<span className="text-xs font-medium uppercase tracking-wide text-[var(--nx-muted)]">{t('auth.password')}</span>
										<div className="relative mt-1.5">
											<Lock size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--nx-muted)]" />
											<input
												type={showPw ? 'text' : 'password'}
												required
												minLength={8}
												autoComplete="new-password"
												value={password}
												onChange={(e) => setPassword(e.target.value)}
												className="w-full rounded-lg border border-[var(--nx-border)] bg-transparent py-2.5 pl-9 pr-10 text-sm outline-none transition-colors placeholder:text-zinc-600 focus:border-cyan-500"
											/>
											<button type="button" tabIndex={-1} onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--nx-muted)] transition-colors hover:text-[var(--nx-text)]">
												{showPw ? <EyeOff size={15} /> : <Eye size={15} />}
											</button>
										</div>
									</label>
								</motion.div>

								{/* confirm password */}
								<motion.div {...field(reduced, 3)}>
									<label className="block">
										<span className="text-xs font-medium uppercase tracking-wide text-[var(--nx-muted)]">{t('auth.confirmPassword')}</span>
										<div className="relative mt-1.5">
											<Lock size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--nx-muted)]" />
											<input
												type={showConfirm ? 'text' : 'password'}
												required
												minLength={8}
												autoComplete="new-password"
												value={confirm}
												onChange={(e) => setConfirm(e.target.value)}
												className="w-full rounded-lg border border-[var(--nx-border)] bg-transparent py-2.5 pl-9 pr-10 text-sm outline-none transition-colors placeholder:text-zinc-600 focus:border-cyan-500"
											/>
											<button type="button" tabIndex={-1} onClick={() => setShowConfirm(!showConfirm)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--nx-muted)] transition-colors hover:text-[var(--nx-text)]">
												{showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
											</button>
										</div>
									</label>
								</motion.div>

								{/* error */}
								<AnimatePresence>
									{error && (
										<motion.p
											key="err"
											initial={{ opacity: 0, scale: 0.96 }}
											animate={{ opacity: 1, scale: 1 }}
											exit={{ opacity: 0, scale: 0.96 }}
											className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400"
										>
											{error}
										</motion.p>
									)}
								</AnimatePresence>

								{/* submit */}
								<motion.div {...field(reduced, 4)}>
									<motion.button
										type="submit"
										disabled={busy}
										whileHover={anim ? { scale: 1.01 } : undefined}
										whileTap={anim ? { scale: 0.98 } : undefined}
										className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-600 py-3 text-sm font-medium text-white shadow-[0_0_24px_rgba(6,182,212,0.2)] transition-colors hover:bg-cyan-500 disabled:opacity-50"
									>
										{busy ? <Loader2 size={16} className="animate-spin" /> : <>{t('auth.signupAction')} <ArrowRight size={15} /></>}
									</motion.button>
								</motion.div>
							</form>
							)}

							<motion.p {...field(reduced, 6)} className="mt-5 text-center text-xs text-[var(--nx-muted)]">
								{t('auth.haveAccount')}{' '}
								<Link to="/login" className="font-medium text-cyan-400 transition-colors hover:text-cyan-300">
									{t('nav.login')}
								</Link>
							</motion.p>
						</motion.div>
					)}
				</AnimatePresence>
			</div>
		</AuthLayout>
	);
}
