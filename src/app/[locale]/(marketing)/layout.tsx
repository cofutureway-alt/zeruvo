import { SiteHeader } from '@/components/marketing/site-header';

export default function MarketingLayout(props: {
	children: React.ReactNode;
	params: Promise<{ locale: string }>;
}) {
	return <MarketingLayoutInner params={props.params}>{props.children}</MarketingLayoutInner>;
}

import { getLocale } from 'next-intl/server';
import { AnnouncementsMount } from '@/components/announcements/mount';

async function MarketingLayoutInner(props: {
	children: React.ReactNode;
	params: Promise<{ locale: string }>;
}) {
	const { locale } = await props.params;
	void locale;
	const resolved = await getLocale();
	return (
		<>
			<AnnouncementsMount locale={resolved} />
			<div className="pt-9" /> {/* space under fixed marquee */}
			<SiteHeader locale={resolved} />
			{props.children}
			<footer className="border-t border-[var(--nx-border)] py-10 text-center text-xs text-[var(--nx-muted)]">
				Nexor AI — unified AI gateway
			</footer>
		</>
	);
}
