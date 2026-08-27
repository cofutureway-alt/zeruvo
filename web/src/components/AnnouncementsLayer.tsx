import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { X, ArrowUpRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';

interface Announcement {
	id: string;
	type: 'popup' | 'marquee';
	placement_routes: string[];
	audience_type: 'everyone' | 'anonymous' | 'logged_in' | 'plans';
	plan_ids: string[];
	media_type: 'image' | 'youtube' | 'button';
	image_url: string | null;
	youtube_id: string | null;
	body_text: Record<string, string>;
	cta_label: Record<string, string>;
	cta_url: string | null;
	starts_at?: string | null;
	ends_at?: string | null;
}

const DISMISS_KEY = 'nexor-dismissed-announcements';

function dismissed(): Set<string> {
	try {
		return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) ?? '[]'));
	} catch {
		return new Set();
	}
}

/** Marquee bars + targeted popups (SPA port of the Phase 6 layer). */
export function AnnouncementsLayer() {
	const { pathname } = useLocation();
	const { i18n } = useTranslation();
	const [marquees, setMarquees] = useState<Announcement[]>([]);
	const [popup, setPopup] = useState<Announcement | null>(null);

	useEffect(() => {
		void (async () => {
			const { data } = await supabase.from('announcements').select('*').eq('active', true);
			const now = Date.now();

			const {
				data: { user },
			} = await supabase.auth.getUser();
			let planId: string | null = null;
			if (user) {
				const { data: sub } = await supabase
					.from('subscriptions')
					.select('plan_id')
					.eq('user_id', user.id)
					.eq('status', 'active')
					.gt('expires_at', new Date().toISOString())
					.maybeSingle();
				planId = sub?.plan_id ?? null;
			}

			const gone = dismissed();
			const eligible = ((data ?? []) as Announcement[]).filter((a) => {
				if (gone.has(a.id)) return false;
				const routes = a.placement_routes?.length ? a.placement_routes : ['*'];
				if (!routes.includes('*') && !routes.some((r) => pathname.startsWith(r))) return false;
				if (a.starts_at && new Date(a.starts_at).getTime() > now) return false;
				if (a.ends_at && new Date(a.ends_at).getTime() < now) return false;
				switch (a.audience_type) {
					case 'anonymous':
						return !user;
					case 'logged_in':
						return !!user;
					case 'plans':
						return !!user && !!planId && a.plan_ids.includes(planId);
					default:
						return true;
				}
			});

			setMarquees(eligible.filter((a) => a.type === 'marquee'));
			setPopup((prev) => prev ?? eligible.find((a) => a.type === 'popup') ?? null);
		})();
	}, [pathname]);

	function dismiss(id: string) {
		const next = dismissed();
		next.add(id);
		localStorage.setItem(DISMISS_KEY, JSON.stringify([...next]));
		setPopup(null);
		setMarquees((ms) => ms.filter((m) => m.id !== id));
	}

	const locale = i18n.language;

	return (
		<>
			{marquees.map((m) => (
				<div
					key={m.id}
					className="fixed inset-x-0 top-0 z-[60] flex h-9 items-center overflow-hidden bg-gradient-to-r from-cyan-600 to-violet-600 text-white"
				>
					<div className="marquee-track flex min-w-max items-center gap-16 px-4 text-xs font-medium">
						{Array.from({ length: 6 }).map((_, i) => (
							<span key={i} className="flex items-center gap-3">
								{m.body_text[locale] ?? m.body_text.en}
								{m.cta_url && (
									<a
										href={m.cta_url}
										target="_blank"
										rel="noreferrer"
										className="flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-0.5 hover:bg-white/25"
									>
										{m.cta_label[locale] ?? m.cta_label.en ?? 'Open'}
										<ArrowUpRight size={11} />
									</a>
								)}
							</span>
						))}
					</div>
					<button
						onClick={() => dismiss(m.id)}
						className="absolute end-2 grid size-6 place-items-center rounded-full hover:bg-white/20"
						aria-label="Dismiss"
					>
						<X size={13} />
					</button>
				</div>
			))}

			{popup && (
				<div className="fixed inset-0 z-[70] grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
					<div className="w-full max-w-md overflow-hidden rounded-2xl border border-[var(--nx-border)] bg-[var(--nx-surface)] shadow-2xl">
						<div className="relative">
							<button
								onClick={() => dismiss(popup.id)}
								className="absolute end-2 top-2 z-10 grid size-7 place-items-center rounded-full bg-black/50 text-white hover:bg-black/70"
								aria-label="Close"
							>
								<X size={14} />
							</button>
							{popup.media_type === 'image' && popup.image_url && (
								<img src={popup.image_url} alt="" className="max-h-64 w-full object-cover" />
							)}
							{popup.media_type === 'youtube' && popup.youtube_id && (
								<iframe
									src={`https://www.youtube.com/embed/${popup.youtube_id}`}
									title="Announcement video"
									allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
									allowFullScreen
									className="aspect-video w-full border-0"
								/>
							)}
						</div>
						<div className="p-6">
							<p className="text-sm leading-relaxed">{popup.body_text[locale] ?? popup.body_text.en}</p>
							{popup.cta_url && (
								<a
									href={popup.cta_url}
									target="_blank"
									rel="noreferrer"
									className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500"
								>
									{popup.cta_label[locale] ?? popup.cta_label.en ?? 'Open'}
									<ArrowUpRight size={14} />
								</a>
							)}
						</div>
					</div>
				</div>
			)}
		</>
	);
}
