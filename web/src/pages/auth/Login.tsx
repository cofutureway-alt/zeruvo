import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import { Mail, Lock, Eye, EyeOff, Loader2, ArrowRight } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import AuthLayout from './AuthLayout';

const ease = [0.22, 1, 0.36, 1] as [number, number, number, number];
const field = (reduced: boolean | null, i: number) => ({
	initial: reduced ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 },
	animate: { opacity: 1, y: 0 },
	transition: { duration: 0.4, delay: 0.08 * i, ease },
});

export default function Login() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const location = useLocation();
	const next = (location.state as { next?: string } | null)?.next ?? '/dashboard';
	const reduced = useReducedMotion();

	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [showPw, setShowPw] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const anim = !reduced;

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
		<AuthLayout>
			<div className="space-y-6">
				{/* heading */}
				<motion.div {...field(reduced, 0)}>
					<h1 className="text-xl font-semibold tracking-tight">{t('auth.loginTitle')}</h1>
					<p className="mt-1 text-sm text-[var(--nx-muted)]">{t('auth.loginSubtitle')}</p>
				</motion.div>

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
									autoComplete="current-password"
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									className="w-full rounded-lg border border-[var(--nx-border)] bg-transparent py-2.5 pl-9 pr-10 text-sm outline-none transition-colors placeholder:text-zinc-600 focus:border-cyan-500"
								/>
								<button
									type="button"
									tabIndex={-1}
									onClick={() => setShowPw(!showPw)}
									className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--nx-muted)] transition-colors hover:text-[var(--nx-text)]"
								>
									{showPw ? <EyeOff size={15} /> : <Eye size={15} />}
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
					<motion.div {...field(reduced, 3)}>
						<motion.button
							type="submit"
							disabled={busy}
							whileHover={anim ? { scale: 1.01 } : undefined}
							whileTap={anim ? { scale: 0.98 } : undefined}
							className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-600 py-3 text-sm font-medium text-white shadow-[0_0_24px_rgba(6,182,212,0.2)] transition-colors hover:bg-cyan-500 disabled:opacity-50"
						>
							{busy ? <Loader2 size={16} className="animate-spin" /> : <>{t('auth.loginAction')} <ArrowRight size={15} /></>}
						</motion.button>
					</motion.div>
				</form>

				<motion.p {...field(reduced, 4)} className="text-center text-xs text-[var(--nx-muted)]">
					{t('auth.noAccount')}{' '}
					<Link to="/signup" className="font-medium text-cyan-400 transition-colors hover:text-cyan-300">
						{t('nav.signup')}
					</Link>
				</motion.p>
			</div>
		</AuthLayout>
	);
}
