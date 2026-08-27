import { motion, useReducedMotion } from 'framer-motion';
import { type ReactNode } from 'react';

/**
 * Full-viewport auth wrapper with animated aurora background.
 * Each child (Login/Signup form) is centered with a motion entrance.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
	const reduced = useReducedMotion();

	return (
		<main className="relative min-h-dvh overflow-hidden bg-[var(--nx-bg)]">
			{/* aurora background — two blurred radial gradients */}
			<div className="auth-aurora pointer-events-none absolute inset-0" aria-hidden />

			{/* centered form card */}
			<div className="relative z-10 grid min-h-dvh place-items-center px-4 py-12">
				<motion.div
					initial={reduced ? false : { opacity: 0, y: 18 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
					className="spotlight-card w-full max-w-md rounded-2xl border border-[var(--nx-border)] bg-[var(--nx-surface)]/90 p-8 shadow-2xl backdrop-blur"
				>
					{children}
				</motion.div>
			</div>
		</main>
	);
}
