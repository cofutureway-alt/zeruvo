import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { SiteHeader } from '../components/SiteHeader';
import { AnnouncementsLayer } from '../components/AnnouncementsLayer';
import { Footer } from '../components/Footer';

/**
 * Shared shell: announcements (marquee + popup) + marketing header + footer.
 * Console pages (dashboard/admin) render their own shell — AppLayout skips
 * the marketing header there and only contributes the marquee offset.
 */
export function AppLayout() {
	const [marqueeCount, setMarqueeCount] = useState(0);
	const { pathname } = useLocation();

	useEffect(() => {
		const onCount = (e: Event) => setMarqueeCount((e as CustomEvent<number>).detail ?? 0);
		window.addEventListener('nexor-marquee-count', onCount);
		return () => window.removeEventListener('nexor-marquee-count', onCount);
	}, []);

	const onConsole = pathname.startsWith('/dashboard') || pathname.startsWith('/admin');

	return (
		<>
			<AnnouncementsLayer />
			{/* spacer only when a marquee bar is actually on screen */}
			<div style={{ height: marqueeCount * 36 }} aria-hidden="true" />
			{!onConsole && <SiteHeader />}
			<main>
				<Outlet />
			</main>
			<Footer />
		</>
	);
}
