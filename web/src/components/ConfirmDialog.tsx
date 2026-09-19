import { AlertTriangle, Loader2 } from 'lucide-react';

/**
 * Reusable confirmation dialog (console recipe: overlay + nx-surface card).
 * Used for destructive actions — API-key deletion, offer deletion, …
 */
export function ConfirmDialog({
	open,
	title,
	body,
	error,
	confirmLabel = 'Delete',
	busy = false,
	onConfirm,
	onCancel,
}: {
	open: boolean;
	title: string;
	body?: string;
	error?: string | null;
	confirmLabel?: string;
	busy?: boolean;
	onConfirm: () => void;
	onCancel: () => void;
}) {
	if (!open) return null;
	return (
		<div
			className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
			onClick={busy ? undefined : onCancel}
		>
			<div
				role="alertdialog"
				aria-modal="true"
				className="w-full max-w-sm rounded-2xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-6 shadow-2xl"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-start gap-3">
					<div className="grid size-10 shrink-0 place-items-center rounded-full bg-red-500/10 text-red-400">
						<AlertTriangle size={18} />
					</div>
					<div>
						<h3 className="text-sm font-semibold">{title}</h3>
						{body && <p className="mt-1 text-sm text-[var(--nx-muted)]">{body}</p>}
					</div>
				</div>
				{error && (
					<div className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</div>
				)}
				<div className="mt-5 flex justify-end gap-2">
					<button
						onClick={onCancel}
						disabled={busy}
						className="rounded-lg border border-[var(--nx-border)] px-4 py-2 text-sm hover:border-cyan-500/50 disabled:opacity-40"
					>
						Cancel
					</button>
					<button
						onClick={onConfirm}
						disabled={busy}
						className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-40"
					>
						{busy && <Loader2 size={14} className="animate-spin" />}
						{busy ? 'Working…' : confirmLabel}
					</button>
				</div>
			</div>
		</div>
	);
}
