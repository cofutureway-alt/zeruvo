import { Outlet } from 'react-router-dom';
import { AnnouncementsLayer } from '../components/AnnouncementsLayer';
import { Footer } from '../components/Footer';

/**
 * Shared shell for the console routes (dashboard + admin). Console pages
 * render their own sidebar/topbar (DashboardShell); AppLayout contributes
 * the announcement layer and the site footer.
 */
export function AppLayout() {
	return (
		<>
			<AnnouncementsLayer />
			<main>
				<Outlet />
			</main>
			<Footer />
		</>
	);
}
