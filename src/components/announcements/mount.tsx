'use client';

import { usePathname } from 'next/navigation';
import { AnnouncementsLayer } from './announcements-layer';

/** Client boundary: reads the current pathname for route-targeted announcements. */
export function AnnouncementsMount({ locale }: { locale: string }) {
	const pathname = usePathname() ?? '';
	return <AnnouncementsLayer locale={locale} pathname={pathname} />;
}
