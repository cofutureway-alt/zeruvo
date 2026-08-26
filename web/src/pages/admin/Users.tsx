import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { DashboardShell } from '../../components/DashboardShell';

interface UserRow {
	id: string;
	email: string;
	role: string;
	created_at: string;
}

/** Users list from profiles (RLS admin read) with per-user usage totals. */
export default function Users() {
	const [email, setEmail] = useState('');
	const [users, setUsers] = useState<UserRow[]>([]);
	const [usage, setUsage] = useState<Record<string, number>>({});

	useEffect(() => {
		void (async () => {
			const { data: { user } } = await supabase.auth.getUser();
			setEmail(user?.email ?? '');
			const [{ data: profiles }, { data: usageRows }] = await Promise.all([
				supabase.from('profiles').select('id,role,created_at').order('created_at', { ascending: false }).limit(200),
				supabase.from('daily_usage').select('user_id, consumed_weighted'),
			]);
			const totals: Record<string, number> = {};
			for (const r of usageRows ?? []) {
				totals[r.user_id] = (totals[r.user_id] ?? 0) + Number(r.consumed_weighted);
			}
			// emails live in auth schema — join via the admin edge if needed; show ids otherwise
			setUsers(
				(profiles ?? []).map((p) => ({
					id: p.id,
					email: p.id.slice(0, 8) + '…',
					role: p.role,
					created_at: p.created_at,
				})),
			);
			setUsage(totals);
		})();
	}, []);

	return (
		<DashboardShell variant="admin" email={email}>
			<div className="space-y-6">
				<header>
					<h1 className="text-xl font-semibold tracking-tight">Users</h1>
					<p className="mt-0.5 text-sm text-[var(--nx-muted)]">Accounts, roles and lifetime weighted consumption.</p>
				</header>

				<div className="overflow-hidden rounded-xl border border-[var(--nx-border)]">
					<table className="w-full text-sm">
						<thead className="bg-zinc-900/60 text-xs uppercase tracking-wide text-[var(--nx-muted)]">
							<tr>
								<th className="px-4 py-3 text-start">User</th>
								<th className="px-4 py-3 text-start">Role</th>
								<th className="px-4 py-3 text-start">Joined</th>
								<th className="px-4 py-3 text-end">Lifetime weighted tokens</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-[var(--nx-border)]">
							{users.map((u) => (
								<tr key={u.id}>
									<td className="px-4 py-3 font-mono text-xs">{u.email}</td>
									<td className="px-4 py-3">
										<span className={`rounded-full px-2 py-0.5 text-[11px] ${u.role === 'admin' ? 'bg-indigo-500/10 text-indigo-400' : 'bg-zinc-700/40 text-zinc-400'}`}>
											{u.role}
										</span>
									</td>
									<td className="px-4 py-3 text-xs text-[var(--nx-muted)]">{u.created_at?.slice(0, 10)}</td>
									<td className="px-4 py-3 text-end tabular-nums">{(usage[u.id] ?? 0).toLocaleString()}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
				<p className="text-xs text-[var(--nx-muted)]">
					Email addresses live in the auth schema — expose them via a small edge function when needed.
				</p>
			</div>
		</DashboardShell>
	);
}
