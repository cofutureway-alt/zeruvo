'use client';

import { useState } from 'react';
import { X, Loader2, ShieldCheck } from 'lucide-react';

export function CheckoutModal(props: {
	planId: string;
	planName: string;
	onClose: () => void;
}) {
	const [iframeUrl, setIframeUrl] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	void (async () => {
		if (iframeUrl) return;
		try {
			const res = await fetch('/api/checkout', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ plan_id: props.planId }),
			});
			const json = await res.json();
			if (!res.ok) setError(json.error ?? 'Checkout failed');
			else setIframeUrl(json.checkout_url);
		} catch {
			setError('Network error');
		}
	})();

	return (
		<div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm">
			<div className="flex h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--nx-border)] bg-[var(--nx-surface)] shadow-2xl">
				<header className="flex items-center justify-between border-b border-[var(--nx-border)] px-5 py-3.5">
					<div>
						<p className="text-sm font-medium">Subscribe — {props.planName}</p>
						<p className="flex items-center gap-1 text-[11px] text-[var(--nx-muted)]">
							<ShieldCheck size={11} />
							Secured by Kashier · paid in EGP
						</p>
					</div>
					<button onClick={props.onClose} className="rounded-lg p-1.5 text-[var(--nx-muted)] hover:bg-zinc-800/60">
						<X size={18} />
					</button>
				</header>

				{error ? (
					<div className="grid flex-1 place-items-center p-8 text-center">
						<p className="text-sm text-red-400">{error}</p>
					</div>
				) : iframeUrl ? (
					<iframe
						src={iframeUrl}
						title="Kashier secure checkout"
						className="h-full w-full flex-1 border-0"
						allow="payment"
					/>
				) : (
					<div className="grid flex-1 place-items-center">
						<Loader2 className="animate-spin text-indigo-400" size={28} />
					</div>
				)}
			</div>
		</div>
	);
}
