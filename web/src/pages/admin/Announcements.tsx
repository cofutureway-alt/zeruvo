import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Megaphone } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { DashboardShell } from '../../components/DashboardShell';

interface Announcement {
	id: string;
	type: 'popup' | 'marquee';
	placement_routes: string[];
	audience_type: string;
	plan_ids: string[];
	media_type: string;
	body_text: Record<string, string>;
	active: boolean;
}

export default function Announcements() {
	const [email, setEmail] = useState('');
	const [items, setItems] = useState<Announcement[]>([]);
	const [editingId, setEditingId] = useState<string | null>(null);

	const load = useCallback(async () => {
		const { data: { user } } = await supabase.auth.getUser();
		setEmail(user?.email ?? '');
		const { data } = await supabase.from('announcements').select('*').order('created_at', { ascending: false });
		setItems((data ?? []) as Announcement[]);
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	async function remove(id: string) {
		await supabase.from('announcements').delete().eq('id', id);
		await load();
	}

	async function toggleActive(a: Announcement) {
		await supabase.from('announcements').update({ active: !a.active }).eq('id', a.id);
		await load();
	}

	return (
		<DashboardShell variant="admin" email={email}>
			<div className="space-y-6">
				<header className="flex items-center justify-between">
					<div>
						<h1 className="text-xl font-semibold tracking-tight">Announcements</h1>
						<p className="mt-0.5 text-sm text-[var(--nx-muted)]">
							Popups with audience targeting + the scrolling marquee above the header.
						</p>
					</div>
					<a
						href="#create-note"
						className="rounded-lg border border-[var(--nx-border)] px-4 py-2 text-sm text-[var(--nx-muted)]"
					>
						Create via table editor
					</a>
				</header>

				{items.length === 0 && (
					<p className="rounded-xl border border-dashed border-[var(--nx-border)] p-10 text-center text-sm text-[var(--nx-muted)]">
						No announcements yet — insert rows in the announcements table (popup | marquee).
					</p>
				)}

				{editingId && <CreateInline onDone={() => setEditingId(null)} onSaved={load} />}

				<div className="space-y-3">
					{items.map((a) => (
						<article key={a.id} className="flex items-center gap-4 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-4">
							<div className={`grid size-9 shrink-0 place-items-center rounded-lg ${a.type === 'marquee' ? 'bg-sky-500/10' : 'bg-violet-500/10'}`}>
								<Megaphone size={17} className={a.type === 'marquee' ? 'text-sky-400' : 'text-violet-400'} />
							</div>
							<div className="min-w-0 flex-1">
								<div className="flex flex-wrap items-center gap-2">
									<span className="rounded-md bg-zinc-800 px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-zinc-300">{a.type}</span>
									<span className="rounded-md bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-400">{a.audience_type}</span>
									<span className="truncate rounded-md bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-400">{(a.placement_routes ?? ['*']).join(', ')}</span>
									<button onClick={() => toggleActive(a)} className={`rounded-md px-1.5 py-0.5 text-[11px] ${a.active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-700/50 text-zinc-400'}`}>
										{a.active ? 'active' : 'inactive'}
									</button>
								</div>
								<p className="mt-1 truncate text-sm">{a.body_text?.en ?? '(no text)'}</p>
							</div>
							<button onClick={() => remove(a.id)} className="rounded-lg p-2 text-[var(--nx-muted)] hover:bg-red-500/10 hover:text-red-400" aria-label="Delete">
								<Trash2 size={15} />
							</button>
						</article>
					))}
				</div>
			</div>
		</DashboardShell>
	);
}

/** Inline create form — full CRUD without leaving the console. */
function CreateInline({ onDone, onSaved }: { onDone: () => void; onSaved: () => void }) {
	const [type, setType] = useState<'popup' | 'marquee'>('popup');
	const [textEn, setTextEn] = useState('');
	const [textAr, setTextAr] = useState('');
	const [ctaUrl, setCtaUrl] = useState('');
	const [audience, setAudience] = useState('everyone');
	const [routes, setRoutes] = useState('*');
	const [busy, setBusy] = useState(false);

	async function save() {
		if (!textEn.trim()) return;
		setBusy(true);
		await supabase.from('announcements').insert({
			type,
			placement_routes: routes.split(',').map((s) => s.trim()).filter(Boolean),
			audience_type: audience,
			plan_ids: [],
			media_type: 'button',
			body_text: { en: textEn.trim(), ar: textAr.trim() },
			cta_label: { en: 'Open', ar: 'افتح' },
			cta_url: ctaUrl || null,
			active: true,
		});
		onSaved();
		onDone();
	}

	return (
		<div className="space-y-3 rounded-xl border border-cyan-500/40 bg-[var(--nx-surface)] p-5">
			<div className="flex gap-2">
				<select value={type} onChange={(e) => setType(e.target.value as typeof type)} className="rounded-lg border border-[var(--nx-border)] bg-[var(--nx-surface)] px-3 py-2 text-sm outline-none">
					<option value="popup">Popup</option>
					<option value="marquee">Marquee bar</option>
				</select>
				<select value={audience} onChange={(e) => setAudience(e.target.value)} className="rounded-lg border border-[var(--nx-border)] bg-[var(--nx-surface)] px-3 py-2 text-sm outline-none">
					<option value="everyone">Everyone</option>
					<option value="anonymous">Anonymous only</option>
					<option value="logged_in">Logged-in users</option>
				</select>
				<input value={routes} onChange={(e) => setRoutes(e.target.value)} placeholder="routes (* for all)" className="w-40 rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-cyan-500" />
			</div>
			<input value={textEn} onChange={(e) => setTextEn(e.target.value)} placeholder="Text (English) — required" className="w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-cyan-500" />
			<input value={textAr} onChange={(e) => setTextAr(e.target.value)} placeholder="النص (عربي)" dir="rtl" className="w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-cyan-500" />
			<input value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)} placeholder="CTA URL (optional)" dir="ltr" className="w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-cyan-500" />
			<div className="flex justify-end gap-2">
				<button onClick={onDone} className="rounded-lg border border-[var(--nx-border)] px-4 py-2 text-sm">Cancel</button>
				<button onClick={save} disabled={busy || !textEn.trim()} className="rounded-lg bg-cyan-600 px-5 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-40">Save</button>
			</div>
		</div>
	);
}
