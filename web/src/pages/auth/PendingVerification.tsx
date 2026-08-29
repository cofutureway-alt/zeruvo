import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, useReducedMotion } from 'framer-motion';
import { Clock, RefreshCw } from 'lucide-react';
import { useAuth } from '../../auth-context';
import AuthLayout from './AuthLayout';

const ease = [0.22, 1, 0.36, 1] as [number, number, number, number];

/**
 * Shown to a GitHub user whose GitHub account is younger than the admin
 * configured minimum age. Login works — features unlock on the date shown.
 */
export default function PendingVerification() {
	const { t } = useTranslation();
	const { pendingUntil, githubMinAgeDays, user } = useAuth();
	const reduced = useReducedMotion();

	const username = user?.user_metadata?.user_name ?? user?.user_metadata?.preferred_username ?? '';
	const until = pendingUntil;
	const days = until ? Math.max(0, Math.ceil((until.getTime() - Date.now()) / 86_400_000)) : githubMinAgeDays;

	return (
		<AuthLayout>
			<div className="space-y-6 text-center">
				<motion.div
					initial={reduced ? { opacity: 1 } : { opacity: 0, scale: 0.9 }}
					animate={{ opacity: 1, scale: 1 }}
					transition={{ duration: 0.4, ease }}
					className="mx-auto grid size-14 place-items-center rounded-full bg-amber-500/15"
				>
					<Clock size={26} className="text-amber-400" />
				</motion.div>

				<motion.div
					initial={reduced ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.4, delay: 0.08, ease }}
				>
					<h1 className="text-xl font-semibold tracking-tight">{t('auth.pendingTitle')}</h1>
					<p className="mt-2 text-sm leading-relaxed text-[var(--nx-muted)]">
						{t('auth.pendingBody', { days })}
					</p>
					{username && (
						<p className="mt-1 font-mono text-xs text-[var(--nx-muted)]">@{username}</p>
					)}
					{until && (
						<p className="mt-3 inline-block rounded-lg bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300">
							{t('auth.pendingUntil', { date: until.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) })}
						</p>
					)}
				</motion.div>

				<motion.div
					initial={reduced ? { opacity: 1 } : { opacity: 0 }}
					animate={{ opacity: 1 }}
					transition={{ duration: 0.4, delay: 0.16 }}
					className="flex flex-col items-center gap-3"
				>
					{!until && (
						<button
							onClick={() => window.location.reload()}
							className="flex items-center gap-2 rounded-xl border border-[var(--nx-border)] px-4 py-2 text-sm transition-colors hover:border-cyan-500/60 hover:text-cyan-300"
						>
							<RefreshCw size={15} />
							{t('auth.pendingRecheck')}
						</button>
					)}
					<p className="text-xs text-[var(--nx-muted)]">
						{t('auth.haveAccount')}{' '}
						<Link to="/login" className="font-medium text-cyan-400 transition-colors hover:text-cyan-300">
							{t('nav.login')}
						</Link>
					</p>
				</motion.div>
			</div>
		</AuthLayout>
	);
}
