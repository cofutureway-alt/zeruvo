import { useEffect, useRef, useState } from 'react';
import { Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { locales, setLocale, type Locale } from '../i18n-config';

const LOCALE_LABELS: Record<Locale, string> = {
	en: 'English',
	ar: 'العربية',
	fr: 'Français',
	zh: '中文',
};

/** Compact dropdown locale switcher for the header actions capsule. */
export function LocaleSwitcher() {
	const { i18n } = useTranslation();
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const onDown = (e: PointerEvent) => {
			if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') setOpen(false);
		};
		document.addEventListener('pointerdown', onDown);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('pointerdown', onDown);
			document.removeEventListener('keydown', onKey);
		};
	}, [open]);

	return (
		<div className="relative" ref={rootRef}>
			<button
				onClick={() => setOpen((o) => !o)}
				aria-haspopup="menu"
				aria-expanded={open}
				aria-label="Change language"
				className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-sm text-[var(--nx-muted)] transition hover:bg-white/[0.06] hover:text-zinc-100"
			>
				<Globe size={15} />
				<span className="text-xs font-medium uppercase">{i18n.language}</span>
			</button>

			{open && (
				<div
					role="menu"
					className="absolute end-0 top-[calc(100%+8px)] z-[60] w-36 overflow-hidden rounded-xl border border-[var(--nx-border)] bg-[var(--nav-bg-solid,var(--nx-surface))] p-1 shadow-2xl backdrop-blur-xl"
				>
					{locales.map((l) => (
						<button
							key={l}
							role="menuitem"
							onClick={() => {
								setLocale(l);
								setOpen(false);
							}}
							className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition ${
								i18n.language === l
									? 'bg-cyan-500/10 font-medium text-cyan-300'
									: 'text-[var(--nx-muted)] hover:bg-white/[0.05] hover:text-zinc-100'
							}`}
						>
							{LOCALE_LABELS[l]}
							<span className="text-[10px] uppercase opacity-60">{l}</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}
