import { useCallback, useEffect, useState } from 'react';
import {
	Search, Ban, Undo2, Trash2, KeyRound, MailX, ArrowRightLeft,
	ShieldCheck, ShieldOff, Loader2, X,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { DashboardShell } from '../../components/DashboardShell';
import { edgeCall } from '../../lib/admin-api';
import { ConfirmModal } from './Providers';

interface UserRow {
	id: string;
	email: string;
	role: 'admin' | 'user';
	banned?: boolean;
	created_at: string;
	lifetime_weighted: number;
	sub: { plan_name: string; plan_id: string; expires_at: string } | null;
}

export default function Users() {
	const [email, setEmail] = useState('');
	const [users, setUsers] = useState<UserRow[]>([]);
	const [loading, setLoading] = useState(true);
	const [query, setQuery] = useState('');
	const [plans, setPlans] = useState<Array<{ id: string; name: Record<string, string> }>>([]);
	const [managing, setManaging] = useState<UserRow | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		const { data: { me } } = (await supabase.auth.getUser()) as any;
		void me;
		setEmail((await supabase.auth.getUser()).data.user?.email ?? '');

		// emails + ban state live in auth — fetch via the edge function
		const listRes = await edgeCall<{ users?: Array<Record<string, unknown>>; error?: string }>(
			'admin-users-list', {},
		);
		const authUsers = new Map<string, { email: string; banned: boolean }>();
		for (const u of listRes?.users ?? []) {
			authUsers.set(String(u.id), {
				email: String(u.email ?? ''),
				banned: Boolean(u.banned),
			});
		}

		const [{ data: profiles }, { data: usageRows }, { data: subs }, { data: planRows }] = await Promise.all([
			supabase.from('profiles').select('id,role,created_at').order('created_at', { ascending: false }),
			supabase.from('daily_usage').select('user_id, consumed_weighted'),
			supabase
				.from('subscriptions')
				.select('user_id,plan_id,status,expires_at,plans(name)')
				.eq('status', 'active')
				.gt('expires_at', new Date().toISOString()),
			supabase.from('plans').select('id,name').eq('active', true),
		]);

		const lifetime: Record<string, number> = {};
		for (const r of usageRows ?? []) {
			lifetime[r.user_id] = (lifetime[r.user_id] ?? 0) + Number(r.consumed_weighted);
		}
		const subByUser = new Map<string, { plan_id: string; expires_at: string; plans: { name: Record<string, string> } | null }>();
		for (const s of subs ?? []) {
			subByUser.set(s.user_id, s as never);
		}

		setUsers(
			(profiles ?? []).map((p) => {
				const auth = authUsers.get(p.id);
				const sub = subByUser.get(p.id);
				return {
					id: p.id,
					email: auth?.email ?? `${p.id.slice(0, 8)}…`,
					role: p.role,
					banned: auth?.banned ?? false,
					created_at: p.created_at,
					lifetime_weighted: lifetime[p.id] ?? 0,
					sub: sub ? { plan_name: sub.plans?.name?.en ?? '—', plan_id: sub.plan_id, expires_at: sub.expires_at } : null,
				};
			}),
		);
		setPlans(planRows ?? []);
		setLoading(false);
	}, []);

	useEffect(() => { void load(); }, [load]);

	const filtered = users.filter(
		(u) => !query.trim() || u.email.toLowerCase().includes(query.toLowerCase()),
	);

	return (
		<DashboardShell variant="admin" email={email}>
			<div className="space-y-6">
				<header>
					<h1 className="font-display text-xl font-semibold tracking-tight">Users</h1>
					<p className="mt-0.5 text-sm text-[var(--nx-muted)]">
						Roles, bans, passwords, plans and deletion. Every action is audit-logged.
					</p>
				</header>

				<label className="relative block max-w-md">
					<Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-[var(--nx-muted)]" />
					<input
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Search by email…"
						className="w-full rounded-lg border border-[var(--nx-border)] bg-transparent py-2 pe-3 ps-9 text-sm outline-none focus:border-cyan-500"
					/>
				</label>

				{loading ? (
					<div className="space-y-2" aria-busy="true">
						{Array.from({ length: 5 }).map((_, i) => <div key={i} className="nx-skeleton h-14 rounded-xl" />)}
					</div>
				) : (
					<ul className="space-y-2">
						{filtered.map((u) => (
							<li key={u.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] px-5 py-4">
								<div className="min-w-0 flex-1">
									<p className="truncate text-sm font-medium">{u.email}</p>
									<p className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-[var(--nx-muted)]">
										<span className={`rounded-full px-2 py-0.5 ${u.role === 'admin' ? 'bg-cyan-500/10 text-cyan-400' : 'bg-zinc-700/40 text-zinc-400'}`}>
											{u.role}
										</span>
										{u.banned && <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-red-400">banned</span>}
										{u.sub ? (
											<span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-400">
												{u.sub.plan_name} → {u.sub.expires_at.slice(0, 10)}
											</span>
										) : (
											<span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-400">no active plan</span>
										)}
										<span>{Number(u.lifetime_weighted).toLocaleString()} weighted tokens</span>
									</p>
								</div>
								<button
									onClick={() => setManaging(u)}
									className="rounded-lg bg-cyan-600 px-4 py-2 text-xs font-medium text-white hover:bg-cyan-500"
								>
									Manage
								</button>
							</li>
						))}
						{filtered.length === 0 && (
							<li className="rounded-xl border border-dashed border-[var(--nx-border)] py-12 text-center text-sm text-[var(--nx-muted)]">No users match.</li>
						)}
					</ul>
				)}
			</div>

			{managing && (
				<UserManagerModal
					user={managing}
					plans={plans}
					onClose={() => setManaging(null)}
					onChanged={() => { setManaging(null); void load(); }}
				/>
			)}
		</DashboardShell>
	);
}

function UserManagerModal({ user, plans, onClose, onChanged }: {
	user: UserRow;
	plans: Array<{ id: string; name: Record<string, string> }>;
	onClose: () => void;
	onChanged: () => void;
}) {
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [newPassword, setNewPassword] = useState('');
	const [newEmail, setNewEmail] = useState(user.email);
	const [moveToPlan, setMoveToPlan] = useState('');
	const [confirmDelete, setConfirmDelete] = useState(false);

	async function act(action: string, extra: Record<string, unknown> = {}) {
		setBusy(action); setError(null);
		const res = await edgeCall<{ error?: string }>('admin-users', {
			action, user_id: user.id, ...extra,
		});
		if (res?.error) setError(res.error);
		else onChanged();
		setBusy(null);
	}

	return (
		<>
			<div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm">
				<div className="w-full max-w-lg rounded-2xl border border-[var(--nx-border)] bg-[var(--nx-surface)] shadow-2xl">
					<header className="flex items-center justify-between border-b border-[var(--nx-border)] px-6 py-4">
						<div className="min-w-0">
							<h2 className="truncate font-display font-semibold">{user.email}</h2>
							<p className="text-[11px] text-[var(--nx-muted)]">
								{user.sub ? `${user.sub.plan_name} · expires ${user.sub.expires_at.slice(0, 10)}` : 'no active plan'}
							</p>
						</div>
						<button onClick={onClose} className="rounded-lg p-1.5 text-[var(--nx-muted)] hover:bg-zinc-800/60"><X size={18} /></button>
					</header>

					<div className="max-h-[70vh] space-y-5 overflow-y-auto p-6">
						{error && <p className="rounded-lg bg-red-500/10 px-4 py-2.5 text-sm text-red-400">{error}</p>}

						{/* role */}
						<section className="rounded-xl border border-[var(--nx-border)] p-4">
							<h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--nx-muted)]">Role</h3>
							<div className="flex gap-2">
								{user.role === 'admin' ? (
									<button onClick={() => act('set_role', { role: 'user' })} disabled={busy !== null} className="flex items-center gap-1.5 rounded-lg border border-[var(--nx-border)] px-4 py-2 text-sm hover:border-amber-500/60 hover:text-amber-400 disabled:opacity-40">
										{busy === 'set_role' ? <Loader2 size={14} className="animate-spin" /> : <ShieldOff size={14} />}
										Demote to user
									</button>
								) : (
									<button onClick={() => act('set_role', { role: 'admin' })} disabled={busy !== null} className="flex items-center gap-1.5 rounded-lg border border-[var(--nx-border)] px-4 py-2 text-sm hover:border-cyan-500/60 hover:text-cyan-300 disabled:opacity-40">
										{busy === 'set_role' ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
										Promote to admin
									</button>
								)}
							</div>
						</section>

						{/* plan */}
						<section className="rounded-xl border border-[var(--nx-border)] p-4">
							<h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--nx-muted)]">Plan</h3>
							{user.sub && (
								<button onClick={() => act('revoke_plan')} disabled={busy !== null} className="mb-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-red-500/40 py-2 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-40">
									{busy === 'revoke_plan' ? <Loader2 size={14} className="animate-spin" /> : <MailX size={14} />}
									Revoke current plan ({user.sub.plan_name})
								</button>
							)}
							<div className="flex gap-2">
								<select value={moveToPlan} onChange={(e) => setMoveToPlan(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-[var(--nx-border)] bg-[var(--nx-surface)] px-3 py-2 text-sm outline-none focus:border-cyan-500">
									<option value="">Move to plan…</option>
									{plans.map((p) => <option key={p.id} value={p.id}>{p.name.en}{Number(0) === 0 && ` ($${''})`}</option>)}
								</select>
								<button onClick={() => moveToPlan && act('move_plan', { plan_id: moveToPlan })} disabled={!moveToPlan || busy !== null} className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-40">
									{busy === 'move_plan' ? <Loader2 size={14} className="animate-spin" /> : <ArrowRightLeft size={14} />}
									Move
								</button>
							</div>
						</section>

						{/* credentials */}
						<section className="rounded-xl border border-[var(--nx-border)] p-4">
							<h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--nx-muted)]">Credentials</h3>
							<div className="space-y-3">
								<div className="flex gap-2">
									<input
										type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
										placeholder="New password (min 8)"
										className="min-w-0 flex-1 rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-cyan-500"
									/>
									<button onClick={() => newPassword.length >= 8 && act('reset_password', { new_password: newPassword })} disabled={newPassword.length < 8 || busy !== null} className="shrink-0 rounded-lg border border-[var(--nx-border)] px-4 py-2 text-sm hover:border-mint hover:text-[var(--nx-mint)] disabled:opacity-40">
										{busy === 'reset_password' ? '…' : 'Set password'}
									</button>
								</div>
								<div className="flex gap-2">
									<input
										type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
										placeholder="Change email"
										className="min-w-0 flex-1 rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-cyan-500"
									/>
									<button onClick={() => newEmail !== user.email && act('change_email', { new_email: newEmail })} disabled={newEmail === user.email || busy !== null} className="shrink-0 rounded-lg border border-[var(--nx-border)] px-4 py-2 text-sm hover:border-mint hover:text-[var(--nx-mint)] disabled:opacity-40">
										{busy === 'change_email' ? '…' : 'Update'}
									</button>
								</div>
							</div>
						</section>

						{/* danger zone */}
						<section className="rounded-xl border border-red-500/30 p-4">
							<h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-red-400">Danger zone</h3>
							<div className="space-y-2">
								<button onClick={() => act(user.banned ? 'unban' : 'ban')} disabled={busy !== null} className={`flex w-full items-center justify-center gap-1.5 rounded-lg border py-2 text-sm disabled:opacity-40 ${user.banned ? 'border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10' : 'border-amber-500/40 text-amber-400 hover:bg-amber-500/10'}`}>
									{busy === (user.banned ? 'unban' : 'ban') ? <Loader2 size={14} className="animate-spin" /> : user.banned ? <Undo2 size={14} /> : <Ban size={14} />}
									{user.banned ? 'Lift ban (restore access)' : 'Ban account (block sign-in & API)'}
								</button>
								<button onClick={() => setConfirmDelete(true)} disabled={busy !== null} className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-red-500/40 py-2 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-40">
									<Trash2 size={14} />
									Delete account permanently
								</button>
							</div>
						</section>
					</div>
				</div>
			</div>

			{confirmDelete && (
				<ConfirmModal
					title={`Delete ${user.email}?`}
					body="This permanently removes the account, its API keys, subscriptions and usage history. This cannot be undone."
					confirmLabel="Delete forever"
					onCancel={() => setConfirmDelete(false)}
					onConfirm={() => { setConfirmDelete(false); void act('delete'); }}
				/>
			)}
		</>
	);
}
