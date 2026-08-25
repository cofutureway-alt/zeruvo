'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Upload, Trash2, Building2 } from 'lucide-react';

interface Category {
	id: string;
	name: string;
	icon_url: string | null;
	sort_order: number;
}

/** Admin: company categories with icon upload to public Storage bucket. */
export function ModelsAdminClient() {
	const [cats, setCats] = useState<Category[]>([]);
	const [name, setName] = useState('');
	const [busy, setBusy] = useState(false);

	const load = useCallback(async () => {
		const admin = await import('@/lib/supabase/client').then((m) => m.createClient());
		const { data } = await admin.from('model_categories').select('*').order('sort_order');
		setCats(data ?? []);
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	async function create() {
		if (!name.trim()) return;
		setBusy(true);
		const admin = await import('@/lib/supabase/client').then((m) => m.createClient());
		await admin.from('model_categories').insert({ name: name.trim(), sort_order: cats.length });
		setName('');
		await load();
		setBusy(false);
	}

	async function uploadIcon(catId: string, file: File) {
		setBusy(true);
		const admin = await import('@/lib/supabase/client').then((m) => m.createClient());
		const ext = file.name.split('.').pop();
		const path = `categories/${catId}.${ext}`;
		await admin.storage.from('public-media').upload(path, file, { upsert: true });
		const { data } = admin.storage.from('public-media').getPublicUrl(path);
		await admin.from('model_categories').update({ icon_url: data.publicUrl }).eq('id', catId);
		await load();
		setBusy(false);
	}

	async function remove(id: string) {
		const admin = await import('@/lib/supabase/client').then((m) => m.createClient());
		await admin.from('model_categories').delete().eq('id', id);
		await load();
	}

	return (
		<div className="space-y-6">
			<header>
				<h1 className="text-xl font-semibold tracking-tight">Models & Categories</h1>
				<p className="mt-0.5 text-sm text-[var(--nx-muted)]">
					Company categories shown as filters on the public models page. Assign models to a
					category from the provider&apos;s model selector.
				</p>
			</header>

			{/* create */}
			<div className="flex gap-2">
				<input
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="Category name (e.g. Anthropic)"
					className="w-72 rounded-lg border border-[var(--nx-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-500"
				/>
				<button
					onClick={create}
					disabled={busy || !name.trim()}
					className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
				>
					<Plus size={15} />
					Add
				</button>
			</div>

			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{cats.map((c) => (
					<article
						key={c.id}
						className="flex items-center gap-3 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-4"
					>
						{c.icon_url ? (
							// eslint-disable-next-line @next/next/no-img-element
							<img src={c.icon_url} alt="" className="size-10 rounded-lg object-contain" />
						) : (
							<div className="grid size-10 place-items-center rounded-lg bg-zinc-800/60 text-[var(--nx-muted)]">
								<Building2 size={18} />
							</div>
						)}
						<div className="min-w-0 flex-1">
							<p className="truncate text-sm font-medium">{c.name}</p>
							<label className="flex cursor-pointer items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300">
								<Upload size={11} />
								{c.icon_url ? 'Replace icon' : 'Upload icon'}
								<input
									type="file"
									accept="image/*"
									className="hidden"
									onChange={(e) => e.target.files?.[0] && uploadIcon(c.id, e.target.files[0])}
								/>
							</label>
						</div>
						<button onClick={() => remove(c.id)} className="rounded-lg p-2 text-[var(--nx-muted)] hover:bg-red-500/10 hover:text-red-400">
							<Trash2 size={15} />
						</button>
					</article>
				))}
			</div>

			<p className="text-xs text-[var(--nx-muted)]">
				Icons upload to the <span className="font-mono">public-media</span> Storage bucket — create
				it once from the Supabase dashboard (Storage → New bucket → public).
			</p>
		</div>
	);
}
