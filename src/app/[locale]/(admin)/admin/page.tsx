import { redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';

/** Admin home — server-side role check (defense in depth beyond middleware). */
export default async function AdminHome(props: { params: Promise<{ locale: string }> }) {
	const { locale } = await props.params;
	setRequestLocale(locale);

	const supabase = await createClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();

	if (!user) redirect(`/${locale}/login`);

	const { data: profile } = await supabase
		.from('profiles')
		.select('role')
		.eq('id', user.id)
		.single();

	if (profile?.role !== 'admin') redirect(`/${locale}/dashboard`);

	return (
		<div className="space-y-4">
			<h1 className="text-2xl font-semibold tracking-tight">Admin Console</h1>
			<p className="text-sm text-[var(--nx-muted)]">
				Providers wizard, plans builder, users, payments, coupons and announcements arrive
				in Phases 3–6.
			</p>
		</div>
	);
}
