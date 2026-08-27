import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { gsap } from 'gsap';
import './PillNav.css';

export interface PillNavItem {
	label: string;
	href: string;
	ariaLabel?: string;
}

interface PillNavProps {
	/** Brand mark — rendered inside the rotating circle (a letter, an <img>, an icon). */
	logo: ReactNode;
	/** Wordmark next to the circle. Omit for a mark-only brand pill. */
	logoWord?: ReactNode;
	logoHref?: string;
	logoAriaLabel?: string;
	items: PillNavItem[];
	activeHref?: string;
	className?: string;
	ease?: string;
	/** Hover circle / active dot / logo gradient. */
	baseColor?: string;
	baseColorAlt?: string;
	/** Capsule surface + border. */
	navBgColor?: string;
	navBgSolidColor?: string;
	navBorderColor?: string;
	navBorderBrightColor?: string;
	navTextColor?: string;
	pillColor?: string;
	pillTextColor?: string;
	hoveredPillTextColor?: string;
	/** Rendered in a trailing capsule on desktop (auth buttons, locale switch…). */
	actions?: ReactNode;
	/** Appended below the links inside the mobile popover; receives a closer. */
	mobileExtra?: (close: () => void) => ReactNode;
	onMobileMenuClick?: () => void;
	initialLoadAnimation?: boolean;
}

const isExternalLink = (href: string) =>
	href.startsWith('http://') ||
	href.startsWith('https://') ||
	href.startsWith('//') ||
	href.startsWith('mailto:') ||
	href.startsWith('tel:') ||
	href.startsWith('#');

const isRouterLink = (href?: string) => !!href && !isExternalLink(href);

export default function PillNav({
	logo,
	logoWord,
	logoHref = '/',
	logoAriaLabel = 'Home',
	items,
	activeHref,
	className = '',
	ease = 'power3.easeOut',
	baseColor = '#22d3ee',
	baseColorAlt = '#10b981',
	navBgColor = 'rgba(14, 21, 32, 0.72)',
	navBgSolidColor = 'rgba(14, 21, 32, 0.94)',
	navBorderColor = '#1c2a3a',
	navBorderBrightColor = '#2a3e52',
	navTextColor = '#e8edf4',
	pillColor = 'rgba(255, 255, 255, 0.04)',
	pillTextColor = '#7e8ea0',
	hoveredPillTextColor = '#04202a',
	actions,
	mobileExtra,
	onMobileMenuClick,
	initialLoadAnimation = true,
}: PillNavProps) {
	const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
	const circleRefs = useRef<(HTMLSpanElement | null)[]>([]);
	const tlRefs = useRef<(gsap.core.Timeline | undefined)[]>([]);
	const activeTweenRefs = useRef<(gsap.core.Tween | undefined)[]>([]);
	const logoMarkRef = useRef<HTMLSpanElement>(null);
	const logoTweenRef = useRef<gsap.core.Tween | null>(null);
	const hamburgerRef = useRef<HTMLButtonElement>(null);
	const mobileMenuRef = useRef<HTMLDivElement>(null);
	const navItemsRef = useRef<HTMLDivElement>(null);
	const logoRef = useRef<HTMLAnchorElement | null>(null);

	const reduce = useMemo(
		() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
		[],
	);

	useEffect(() => {
		// Build one paused timeline per pill: a circle rises from the bottom edge
		// while the resting label slides out and the hover label slides in.
		const layout = () => {
			circleRefs.current.forEach((circle) => {
				if (!circle?.parentElement) return;

				const pill = circle.parentElement;
				const { width: w, height: h } = pill.getBoundingClientRect();
				if (!w || !h) return;

				const R = ((w * w) / 4 + h * h) / (2 * h);
				const D = Math.ceil(2 * R) + 2;
				const delta = Math.ceil(R - Math.sqrt(Math.max(0, R * R - (w * w) / 4))) + 1;
				const originY = D - delta;

				circle.style.width = `${D}px`;
				circle.style.height = `${D}px`;
				circle.style.bottom = `-${delta}px`;

				gsap.set(circle, { xPercent: -50, scale: 0, transformOrigin: `50% ${originY}px` });

				const label = pill.querySelector<HTMLElement>('.pill-label');
				const hoverLabel = pill.querySelector<HTMLElement>('.pill-label-hover');

				if (label) gsap.set(label, { y: 0 });
				if (hoverLabel) gsap.set(hoverLabel, { y: h + 12, opacity: 0 });

				const index = circleRefs.current.indexOf(circle);
				if (index === -1) return;

				tlRefs.current[index]?.kill();
				const tl = gsap.timeline({ paused: true });

				tl.to(circle, { scale: 1.2, xPercent: -50, duration: 2, ease, overwrite: 'auto' }, 0);
				if (label) tl.to(label, { y: -(h + 8), duration: 2, ease, overwrite: 'auto' }, 0);
				if (hoverLabel) {
					gsap.set(hoverLabel, { y: Math.ceil(h + 100), opacity: 0 });
					tl.to(hoverLabel, { y: 0, opacity: 1, duration: 2, ease, overwrite: 'auto' }, 0);
				}

				tlRefs.current[index] = tl;
			});
		};

		layout();

		const onResize = () => layout();
		window.addEventListener('resize', onResize);
		if (document.fonts?.ready) void document.fonts.ready.then(layout).catch(() => {});

		if (mobileMenuRef.current) {
			gsap.set(mobileMenuRef.current, { visibility: 'hidden', opacity: 0, scaleY: 1 });
		}

		if (initialLoadAnimation && !reduce) {
			if (logoRef.current) {
				gsap.set(logoRef.current, { scale: 0 });
				gsap.to(logoRef.current, { scale: 1, duration: 0.6, ease });
			}
			if (navItemsRef.current) {
				gsap.set(navItemsRef.current, { width: 0, overflow: 'hidden' });
				gsap.to(navItemsRef.current, {
					width: 'auto',
					duration: 0.6,
					ease,
					onComplete: () => gsap.set(navItemsRef.current, { overflow: 'visible' }),
				});
			}
		}

		return () => window.removeEventListener('resize', onResize);
	}, [items, ease, initialLoadAnimation, reduce]);

	const handleEnter = (i: number) => {
		const tl = tlRefs.current[i];
		if (!tl) return;
		activeTweenRefs.current[i]?.kill();
		if (reduce) {
			tl.progress(1);
			return;
		}
		activeTweenRefs.current[i] = tl.tweenTo(tl.duration(), { duration: 0.3, ease, overwrite: 'auto' });
	};

	const handleLeave = (i: number) => {
		const tl = tlRefs.current[i];
		if (!tl) return;
		activeTweenRefs.current[i]?.kill();
		if (reduce) {
			tl.progress(0);
			return;
		}
		activeTweenRefs.current[i] = tl.tweenTo(0, { duration: 0.2, ease, overwrite: 'auto' });
	};

	const handleLogoEnter = () => {
		const mark = logoMarkRef.current;
		if (!mark || reduce) return;
		logoTweenRef.current?.kill();
		gsap.set(mark, { rotate: 0 });
		logoTweenRef.current = gsap.to(mark, { rotate: 360, duration: 0.45, ease, overwrite: 'auto' });
	};

	const toggleMobileMenu = () => {
		const next = !isMobileMenuOpen;
		setIsMobileMenuOpen(next);

		const lines = hamburgerRef.current?.querySelectorAll<HTMLElement>('.hamburger-line');
		if (lines?.length === 2) {
			gsap.to(lines[0], { rotation: next ? 45 : 0, y: next ? 3.5 : 0, duration: 0.3, ease });
			gsap.to(lines[1], { rotation: next ? -45 : 0, y: next ? -3.5 : 0, duration: 0.3, ease });
		}

		const menu = mobileMenuRef.current;
		if (menu) {
			if (next) {
				gsap.set(menu, { visibility: 'visible' });
				gsap.fromTo(
					menu,
					{ opacity: 0, y: 10, scaleY: 1 },
					{ opacity: 1, y: 0, scaleY: 1, duration: 0.3, ease, transformOrigin: 'top center' },
				);
			} else {
				gsap.to(menu, {
					opacity: 0,
					y: 10,
					scaleY: 1,
					duration: 0.2,
					ease,
					transformOrigin: 'top center',
					onComplete: () => gsap.set(menu, { visibility: 'hidden' }),
				});
			}
		}

		onMobileMenuClick?.();
	};

	const closeMobileMenu = () => {
		if (!isMobileMenuOpen) return;
		toggleMobileMenu();
	};

	const cssVars = {
		'--base': baseColor,
		'--base-2': baseColorAlt,
		'--nav-bg': navBgColor,
		'--nav-bg-solid': navBgSolidColor,
		'--nav-border': navBorderColor,
		'--nav-border-bright': navBorderBrightColor,
		'--nav-text': navTextColor,
		'--pill-bg': pillColor,
		'--pill-text': pillTextColor,
		'--hover-text': hoveredPillTextColor,
	} as CSSProperties;

	const brand = (
		<>
			<span className="pill-logo__mark" ref={logoMarkRef}>
				{logo}
			</span>
			{logoWord && <span className="pill-logo__word">{logoWord}</span>}
		</>
	);

	return (
		<div className="pill-nav-container" style={cssVars}>
			<nav className={`pill-nav ${className}`} aria-label="Primary">
				{isRouterLink(logoHref) ? (
					<Link
						className="pill-logo pill-capsule"
						to={logoHref}
						aria-label={logoAriaLabel}
						onMouseEnter={handleLogoEnter}
						ref={logoRef}
					>
						{brand}
					</Link>
				) : (
					<a
						className="pill-logo pill-capsule"
						href={logoHref}
						aria-label={logoAriaLabel}
						onMouseEnter={handleLogoEnter}
						ref={logoRef}
					>
						{brand}
					</a>
				)}

				<div className="pill-nav-items pill-capsule desktop-only" ref={navItemsRef}>
					<ul className="pill-list" role="menubar">
						{items.map((item, i) => {
							const active = activeHref === item.href;
							const inner = (
								<>
									<span
										className="hover-circle"
										aria-hidden="true"
										ref={(el) => {
											circleRefs.current[i] = el;
										}}
									/>
									<span className="label-stack">
										<span className="pill-label">{item.label}</span>
										<span className="pill-label-hover" aria-hidden="true">
											{item.label}
										</span>
									</span>
								</>
							);

							return (
								<li key={item.href || `item-${i}`} role="none">
									{isRouterLink(item.href) ? (
										<Link
											role="menuitem"
											to={item.href}
											className={`pill${active ? ' is-active' : ''}`}
											aria-label={item.ariaLabel || item.label}
											aria-current={active ? 'page' : undefined}
											onMouseEnter={() => handleEnter(i)}
											onMouseLeave={() => handleLeave(i)}
										>
											{inner}
										</Link>
									) : (
										<a
											role="menuitem"
											href={item.href}
											className={`pill${active ? ' is-active' : ''}`}
											aria-label={item.ariaLabel || item.label}
											onMouseEnter={() => handleEnter(i)}
											onMouseLeave={() => handleLeave(i)}
										>
											{inner}
										</a>
									)}
								</li>
							);
						})}
					</ul>
				</div>

				{actions && <div className="pill-actions pill-capsule desktop-only">{actions}</div>}

				<button
					className="mobile-menu-button pill-capsule mobile-only"
					onClick={toggleMobileMenu}
					aria-label="Toggle menu"
					aria-expanded={isMobileMenuOpen}
					ref={hamburgerRef}
				>
					<span className="hamburger-line" />
					<span className="hamburger-line" />
				</button>
			</nav>

			<div className="mobile-menu-popover mobile-only" ref={mobileMenuRef}>
				<ul className="mobile-menu-list">
					{items.map((item, i) => (
						<li key={item.href || `mobile-item-${i}`}>
							{isRouterLink(item.href) ? (
								<Link
									to={item.href}
									className={`mobile-menu-link${activeHref === item.href ? ' is-active' : ''}`}
									onClick={closeMobileMenu}
								>
									{item.label}
								</Link>
							) : (
								<a
									href={item.href}
									className={`mobile-menu-link${activeHref === item.href ? ' is-active' : ''}`}
									onClick={closeMobileMenu}
								>
									{item.label}
								</a>
							)}
						</li>
					))}
				</ul>
				{mobileExtra && <div className="mobile-menu-extra">{mobileExtra(closeMobileMenu)}</div>}
			</div>
		</div>
	);
}
