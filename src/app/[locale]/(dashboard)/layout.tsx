import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { DashboardShell } from '@/components/dashboard/shell';

export default async function DashboardGroupLayout(props: { children: React.ReactNode }) {
	const supabase = await createClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();

	if (!user) redirect('/en/login');

	const { data: profile } = await supabase
		.from('profiles')
		.select('role')
		.eq('id', user.id)
		.single();

	return (
		<DashboardShell email={user.email ?? ''} isAdmin={profile?.role === 'admin'}>
			{props.children}
		</DashboardShell>
	);
}
