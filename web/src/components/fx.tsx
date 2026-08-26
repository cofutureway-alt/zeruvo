import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * React-Bits style micro-effects used across the app.
 * All respect prefers-reduced-motion via the .split-word/.reveal CSS gates.
 */

/** SplitText — headline words rise into place with a stagger. */
export function SplitText({ text, className = '', delay = 0 }: { text: string; className?: string; delay?: number }) {
	return (
		<span className={className} aria-label={text} role="text">
			{text.split(' ').map((word, i) => (
				<span key={i} aria-hidden>
					<span className="split-word" style={{ animationDelay: `${delay + i * 70}ms` }}>
						{word}
					</span>
					{i < text.split(' ').length - 1 ? ' ' : ''}
				</span>
			))}
		</span>
	);
}

/** CountUp — number climbs to its target when scrolled into view. */
export function CountUp({
	to,
	suffix = '',
	duration = 1400,
	className = '',
}: {
	to: number;
	suffix?: string;
	duration?: number;
	className?: string;
}) {
	const ref = useRef<HTMLSpanElement>(null);
	const [value, setValue] = useState(0);
	const started = useRef(false);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const io = new IntersectionObserver(
			(entries) => {
				if (!entries[0].isIntersecting || started.current) return;
				started.current = true;
				if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
					setValue(to);
					return;
				}
				const t0 = performance.now();
				const tick = (t: number) => {
					const p = Math.min((t - t0) / duration, 1);
					const eased = 1 - Math.pow(1 - p, 3);
					setValue(Math.round(to * eased));
					if (p < 1) requestAnimationFrame(tick);
				};
				requestAnimationFrame(tick);
			},
			{ threshold: 0.4 },
		);
		io.observe(el);
		return () => io.disconnect();
	}, [to, duration]);

	return (
		<span ref={ref} className={className}>
			{value.toLocaleString()}
			{suffix}
		</span>
	);
}

/** SpotlightCard — pointer-following radial glow on hover. */
export function SpotlightCard({ children, className = '' }: { children: ReactNode; className?: string }) {
	const ref = useRef<HTMLDivElement>(null);

	function onMove(e: React.MouseEvent) {
		const el = ref.current;
		if (!el) return;
		const rect = el.getBoundingClientRect();
		el.style.setProperty('--spot-x', `${e.clientX - rect.left}px`);
		el.style.setProperty('--spot-y', `${e.clientY - rect.top}px`);
	}

	return (
		<div ref={ref} onMouseMove={onMove} className={`spotlight-card ${className}`}>
			{children}
		</div>
	);
}

/** Reveal — scroll-triggered fade-slide wrapper. */
export function Reveal({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const io = new IntersectionObserver(
			(entries) => entries[0].isIntersecting && el.classList.add('in-view'),
			{ threshold: 0.15 },
		);
		io.observe(el);
		return () => io.disconnect();
	}, []);

	return (
		<div ref={ref} className={`reveal ${className}`} style={{ transitionDelay: `${delay}ms` }}>
			{children}
		</div>
	);
}

/** SignalDot — live pulsing status indicator. */
export function SignalDot({ color = 'var(--nx-mint)', size = 8 }: { color?: string; size?: number }) {
	return (
		<span
			className="signal-dot"
			style={{ width: size, height: size, borderRadius: 9999, background: color }}
		/>
	);
}
