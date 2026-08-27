import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, Home, SearchX } from 'lucide-react';

const ease = [0.22, 1, 0.36, 1] as [number, number, number, number];

export default function NotFound() {
	const reduced = useReducedMotion();
	const anim = !reduced;

	return (
		<main className="relative grid min-h-dvh place-items-center bg-[var(--nx-bg)] px-4">
			{/* subtle aurora */}
			<div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
				<div className="absolute -left-1/4 -top-1/4 h-[60vh] w-[60vh] rounded-full bg-cyan-500/8 blur-[120px]" />
				<div className="absolute -bottom-1/4 -right-1/4 h-[50vh] w-[50vh] rounded-full bg-teal-500/8 blur-[120px]" />
			</div>

			<motion.div
				initial={anim ? { opacity: 0, y: 20 } : false}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.6, ease }}
				className="relative z-10 text-center"
			>
				<div className="mx-auto mb-6 grid size-20 place-items-center rounded-2xl border border-[var(--nx-border)] bg-[var(--nx-surface)]">
					<SearchX size={36} className="text-cyan-400" />
				</div>

				<h1 className="text-6xl font-bold tracking-tighter text-[var(--nx-text)]">404</h1>
				<p className="mt-3 max-w-sm text-sm text-[var(--nx-muted)]">
					This page doesn't exist or has been moved.
				</p>

				<div className="mt-8 flex items-center justify-center gap-3">
					<Link
						to="/"
						className="flex items-center gap-2 rounded-xl bg-cyan-600 px-5 py-2.5 text-sm font-medium text-white shadow-[0_0_24px_rgba(6,182,212,0.2)] transition-colors hover:bg-cyan-500"
					>
						<Home size={15} />
						Go home
					</Link>
					<button
						onClick={() => history.back()}
						className="flex items-center gap-2 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] px-5 py-2.5 text-sm font-medium text-[var(--nx-text)] transition-colors hover:bg-[var(--nx-surface-hover)]"
					>
						<ArrowLeft size={15} />
						Go back
					</button>
				</div>
			</motion.div>
		</main>
	);
}
