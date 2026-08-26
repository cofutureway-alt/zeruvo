import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { DashboardShell } from '../../components/DashboardShell';
import PlansBrowser from './PlansBrowser';

export default function Plans() {
	const [email, setEmail] = useState('');
	useEffect(() => {
		void supabase.auth.getUser().then(({ data: { user } }) => setEmail(user?.email ?? ''));
	}, []);
	return (
		<DashboardShell variant="user" email={email}>
			<div>
				<h1 className="text-xl font-semibold tracking-tight">Plans</h1>
				<p className="mt-0.5 text-sm text-[var(--nx-muted)]">
					Upgrade for more daily weighted tokens. Checkout with Kashier opens in-place.
				</p>
				<PlansBrowser />
			</div>
		</DashboardShell>
	);
}
