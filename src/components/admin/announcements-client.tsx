'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Megaphone, MessagesSquare, X } from 'lucide-react';

interface Announcement {
	id: string;
	type: 'popup' | 'marquee';
	placement_routes: string[];
	audience_type: 'everyone' | 'anonymous' | 'logged_in' | 'plans';
	plan_ids: string[];
	media_type: 'image' | 'youtube' | 'button';
	image_url?: string | null;
	youtube_id?: string | null;
	body_text: Record<string, string>;
	cta_label: Record<string, string>;
	cta_url?: string | null;
	starts_at?: string | null;
	ends_at?: string | null;
	active: boolean;
}

const LOCALES = ['en', 'ar'] as const;

export function AnnouncementsClient() {
	const [items, setItems] = useState<Announcement[]>([]);
	const [editing, setEditing] = useState<Announcement | 'new' | null>(null);
	const [plans, setPlans] = useState<Array<{ id: string; name: Record<string, string> }>>([]);

	const load = useCallback(async () => {
		const admin = await import('@/lib/supabase/client').then((m) => m.createClient());
		const [{ data }, { data: planRows }] = await Promise.all([
			admin.from('announcements').select('*').order('created_at', { ascending: false }),
			admin.from('plans').select('id,name').eq('active', true),
		]);
		setItems(data ?? []);
		setPlans(planRows ?? []);
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	async function remove(id: string) {
		await fetch(`/api/admin/announcements?id=${id}`, { method: 'DELETE' });
		void load();
	}

	return (
		<div className="space-y-6">
			<header className="flex items-center justify-between">
				<div>
					<h1 className="text-xl font-semibold tracking-tight">Announcements</h1>
					<p className="mt-0.5 text-sm text-[var(--nx-muted)]">
						Popups with audience targeting + the scrolling marquee above the header.
					</p>
				</div>
				<button
					onClick={() => setEditing('new')}
					className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
				>
					<Plus size={16} />
					New announcement
				</button>
			</header>

			<div className="space-y-3">
				{items.length === 0 && (
					<p className="rounded-xl border border-dashed border-[var(--nx-border)] p-10 text-center text-sm text-[var(--nx-muted)]">
						No announcements yet.
					</p>
				)}
				{items.map((a) => (
					<article
						key={a.id}
						className="flex items-center gap-4 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-4"
					>
						<div className={`grid size-9 shrink-0 place-items-center rounded-lg ${a.type === 'marquee' ? 'bg-sky-500/10' : 'bg-violet-500/10'}`}>
							{a.type === 'marquee'
								? <MessagesSquare size={17} className="text-sky-400" />
								: <Megaphone size={17} className="text-violet-400" />}
						</div>
						<div className="min-w-0 flex-1">
							<div className="flex flex-wrap items-center gap-2">
								<span className="rounded-md bg-zinc-800 px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-zinc-300">
									{a.type}
								</span>
								<span className="rounded-md bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-400">
									{a.audience_type}
									{a.audience_type === 'plans' && ` (${a.plan_ids.length})`}
								</span>
								<span className="truncate rounded-md bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-400">
									{a.placement_routes.join(', ') || '*'}
								</span>
								{!a.active && (
									<span className="rounded-md bg-zinc-700/50 px-1.5 py-0.5 text-[11px]">inactive</span>
								)}
							</div>
							<p className="mt-1 truncate text-sm">{a.body_text?.en ?? a.body_text?.ar ?? '(no text)'}</p>
						</div>
						<button onClick={() => setEditing(a)} className="rounded-lg p-2 text-[var(--nx-muted)] hover:bg-zinc-800/60 hover:text-zinc-200">
							<Pencil size={15} />
						</button>
						<button onClick={() => remove(a.id)} className="rounded-lg p-2 text-[var(--nx-muted)] hover:bg-red-500/10 hover:text-red-400">
							<Trash2 size={15} />
						</button>
					</article>
				))}
			</div>

			{editing && (
				<AnnouncementEditor
					initial={editing === 'new' ? null : editing}
					plans={plans}
					onClose={() => {
						setEditing(null);
						void load();
					}}
				/>
			)}
		</div>
	);
}

function AnnouncementEditor(props: {
	initial: Announcement | null;
	plans: Array<{ id: string; name: Record<string, string> }>;
	onClose: () => void;
}) {
	const p = props.initial;
	const [type, setType] = useState<'popup' | 'marquee'>(p?.type ?? 'popup');
	const [routes, setRoutes] = useState((p?.placement_routes ?? ['*']).join(', '));
	const [audience, setAudience] = useState(p?.audience_type ?? 'everyone');
	const [planIds, setPlanIds] = useState<Set<string>>(new Set(p?.plan_ids ?? []));
	const [mediaType, setMediaType] = useState(p?.media_type ?? 'button');
	const [imageUrl, setImageUrl] = useState(p?.image_url ?? '');
	const [youtubeId, setYoutubeId] = useState(p?.youtube_id ?? '');
	const [texts, setTexts] = useState<Record<string, string>>(
		p?.body_text ?? { en: '', ar: '' },
	);
	const [ctas, setCtas] = useState<Record<string, string>>(p?.cta_label ?? { en: '', ar: '' });
	const [ctaUrl, setCtaUrl] = useState(p?.cta_url ?? '');
	const [startsAt, setStartsAt] = useState(p?.starts_at?.slice(0, 16) ?? '');
	const [endsAt, setEndsAt] = useState(p?.ends_at?.slice(0, 16) ?? '');
	const [active, setActive] = useState(p?.active ?? true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function save() {
		if (!texts.en.trim()) {
			setError('English text is required');
			return;
		}
		setBusy(true);
		setError(null);
		const payload = {
			id: p?.id,
			type,
			placement_routes: routes.split(',').map((s) => s.trim()).filter(Boolean),
			audience_type: audience,
			plan_ids: audience === 'plans' ? [...planIds] : [],
			media_type: mediaType,
			image_url: mediaType === 'image' ? imageUrl : null,
			youtube_id: mediaType === 'youtube' ? youtubeId : null,
			body_text: texts,
			cta_label: ctas,
			cta_url: ctaUrl || null,
			starts_at: startsAt ? new Date(startsAt).toISOString() : null,
			ends_at: endsAt ? new Date(endsAt).toISOString() : null,
			active,
		};
		const res = await fetch('/api/admin/announcements', {
			method: p ? 'PATCH' : 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		});
		if (!res.ok) setError((await res.json()).error ?? 'Save failed');
		else props.onClose();
		setBusy(false);
	}

	return (
		<div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm">
			<div className="w-full max-w-xl rounded-2xl border border-[var(--nx-border)] bg-[var(--nx-surface)] shadow-2xl">
				<header className="flex items-center justify-between border-b border-[var(--nx-border)] px-6 py-4">
					<h2 className="font-semibold">{p ? 'Edit announcement' : 'New announcement'}</h2>
					<button onClick={props.onClose} className="rounded-lg p-1.5 text-[var(--nx-muted)] hover:bg-zinc-800/60">
						<X size={18} />
					</button>
				</header>

				<div className="max-h-[70vh] space-y-5 overflow-y-auto p-6">
					{/* type */}
					<div className="flex gap-3">
						{(['popup', 'marquee'] as const).map((t) => (
							<button
								key={t}
								onClick={() => setType(t)}
								className={`flex-1 rounded-lg border px-3 py-2 text-sm capitalize ${
									type === t
										? t === 'popup'
											? 'border-violet-500 bg-violet-500/10 text-violet-300'
											: 'border-sky-500 bg-sky-500/10 text-sky-300'
										: 'border-[var(--nx-border)] text-[var(--nx-muted)]'
								}`}
							>
								{t === 'marquee' ? 'Marquee bar (header)' : 'Popup'}
							</button>
						))}
					</div>

					<label className="block">
						<span className="text-sm text-[var(--nx-muted)]">
							Placement routes (comma separated, * = everywhere)
						</span>
						<input
							value={routes}
							onChange={(e) => setRoutes(e.target.value)}
							placeholder="*, /dashboard, /en/models"
							className="mt-1 w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-500"
						/>
					</label>

					<div className="grid grid-cols-2 gap-3">
						<label className="block">
							<span className="text-sm text-[var(--nx-muted)]">Audience</span>
							<select
								value={audience}
								onChange={(e) => setAudience(e.target.value as typeof audience)}
								className="mt-1 w-full rounded-lg border border-[var(--nx-border)] bg-[var(--nx-surface)] px-3 py-2 text-sm outline-none focus:border-indigo-500"
							>
								<option value="everyone">Everyone</option>
								<option value="anonymous">Anonymous only (not logged in)</option>
								<option value="logged_in">Logged-in users</option>
								<option value="plans">Specific plans</option>
							</select>
						</label>
						<label className="block">
							<span className="text-sm text-[var(--nx-muted)]">Media</span>
							<select
								value={mediaType}
								onChange={(e) => setMediaType(e.target.value as typeof mediaType)}
								className="mt-1 w-full rounded-lg border border-[var(--nx-border)] bg-[var(--nx-surface)] px-3 py-2 text-sm outline-none focus:border-indigo-500"
							>
								<option value="button">Text + button only</option>
								<option value="image">Image</option>
								<option value="youtube">YouTube video</option>
							</select>
						</label>
					</div>

					{audience === 'plans' && (
						<fieldset>
							<legend className="mb-2 text-sm text-[var(--nx-muted)]">Target plans</legend>
							<div className="space-y-1.5 rounded-lg border border-[var(--nx-border)] p-3">
								{props.plans.map((pl) => (
									<label key={pl.id} className="flex items-center gap-2 text-sm">
										<input
											type="checkbox"
											checked={planIds.has(pl.id)}
											onChange={(e) => {
												const next = new Set(planIds);
												if (e.target.checked) next.add(pl.id);
												else next.delete(pl.id);
												setPlanIds(next);
											}}
										/>
										{pl.name.en}
									</label>
								))}
							</div>
						</fieldset>
					)}

					{mediaType === 'image' && (
						<label className="block">
							<span className="text-sm text-[var(--nx-muted)]">Image URL</span>
							<input
								value={imageUrl}
								onChange={(e) => setImageUrl(e.target.value)}
								placeholder="https://…"
								className="mt-1 w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-500"
							/>
						</label>
					)}
					{mediaType === 'youtube' && (
						<label className="block">
							<span className="text-sm text-[var(--nx-muted)]">YouTube video ID</span>
							<input
								value={youtubeId}
								onChange={(e) => setYoutubeId(e.target.value)}
								placeholder="dQw4w9WgXcQ"
								className="mt-1 w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-indigo-500"
							/>
						</label>
					)}

					{/* localized text */}
					<div className="space-y-2">
						{LOCALES.map((l) => (
							<div key={l} className="grid grid-cols-[3fr_2fr] gap-2">
								<input
									value={texts[l] ?? ''}
									onChange={(e) => setTexts({ ...texts, [l]: e.target.value })}
									placeholder={`Text (${l})${l === 'en' ? ' — required' : ''}`}
									className="w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-500"
								/>
								<input
									value={ctas[l] ?? ''}
									onChange={(e) => setCtas({ ...ctas, [l]: e.target.value })}
									placeholder={`Button label (${l})`}
									className="w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-500"
								/>
							</div>
						))}
						<input
							value={ctaUrl}
							onChange={(e) => setCtaUrl(e.target.value)}
							placeholder="CTA URL (https://…)"
							className="w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-500"
						/>
					</div>

					<div className="grid grid-cols-2 gap-3">
						<label className="block">
							<span className="text-sm text-[var(--nx-muted)]">Starts at (optional)</span>
							<input
								type="datetime-local"
								value={startsAt}
								onChange={(e) => setStartsAt(e.target.value)}
								className="mt-1 w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-500"
							/>
						</label>
						<label className="block">
							<span className="text-sm text-[var(--nx-muted)]">Ends at (optional)</span>
							<input
								type="datetime-local"
								value={endsAt}
								onChange={(e) => setEndsAt(e.target.value)}
								className="mt-1 w-full rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-500"
							/>
						</label>
					</div>

					<label className="flex items-center gap-2 text-sm">
						<input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
						Active
					</label>

					{error && <p className="text-sm text-red-400">{error}</p>}
				</div>

				<footer className="flex justify-end gap-2 border-t border-[var(--nx-border)] px-6 py-4">
					<button onClick={props.onClose} className="rounded-lg border border-[var(--nx-border)] px-4 py-2 text-sm">
						Cancel
					</button>
					<button
						onClick={save}
						disabled={busy}
						className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
					>
						{busy ? 'Saving…' : p ? 'Update' : 'Create'}
					</button>
				</footer>
			</div>
		</div>
	);
}
