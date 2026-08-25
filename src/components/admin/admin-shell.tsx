'use client';

import { useRouter } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/client';
import { AdminSidebar } from './admin-sidebar';

export function AdminShell({ email, children }: { email: string; children: React.ReactNode }) {
	const router = useRouter();

	async function logout() {
		await createClient().auth.signOut();
		router.replace('/login');
	}

	return (
		<div className="flex min-h-dvh bg-[var(--nx-bg)]">
			<AdminSidebar email={email} onLogout={logout} />
			<main className="min-w-0 flex-1 p-8">{children}</main>
		</div>
	);
}
