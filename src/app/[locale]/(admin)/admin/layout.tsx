import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AdminShell } from '@/components/admin/admin-shell';

export default async function AdminLayout(props: { children: React.ReactNode }) {
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

	// defense in depth — proxy.ts already gates /admin
	if (profile?.role !== 'admin') redirect('/en/dashboard');

	return (
		<AdminShell email={user.email ?? ''}>{props.children}</AdminShell>
	);
}
