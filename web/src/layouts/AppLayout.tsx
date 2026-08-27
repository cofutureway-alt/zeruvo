import { Outlet } from 'react-router-dom';
import { SiteHeader } from '../components/SiteHeader';
import { AnnouncementsLayer } from '../components/AnnouncementsLayer';

/**
 * Shared shell: announcements (marquee + popup) + marketing header.
 * Dashboard/admin pages render their own sidebars inside the Outlet.
 */
export function AppLayout() {
	return (
		<>
			<AnnouncementsLayer />
			<div className="pt-9" />
			<SiteHeader />
			<main>
				<Outlet />
			</main>
			<footer className="border-t border-[var(--nx-border)] py-10 text-center text-xs text-[var(--nx-muted)]">
				Zeruvo AI — unified AI gateway
			</footer>
		</>
	);
}
