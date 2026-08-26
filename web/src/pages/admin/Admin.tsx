import { DashboardShell } from '../../components/DashboardShell';

export default function Admin() {
	return (
		<DashboardShell variant="admin" email="">
			<div className="space-y-4">
				<h1 className="text-2xl font-semibold tracking-tight">Admin Console</h1>
				<p className="max-w-xl text-sm text-[var(--nx-muted)]">
					Manage providers, model catalogs, plans, users, payments, coupons, announcements and
					payment gateways from the sidebar.
				</p>
			</div>
		</DashboardShell>
	);
}
