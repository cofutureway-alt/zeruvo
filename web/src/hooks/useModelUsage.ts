import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface ModelUsageRow {
	model_id: string;
	display_name: string;
	upstream_model_id: string;
	provider_name?: string;
	requests: number;
	tokens_in: number;
	tokens_out: number;
	weighted_tokens: number;
}

export interface AggTotals {
	requests: number;
	tokens_in: number;
	tokens_out: number;
	weighted_tokens: number;
}

export type TimeRange = '7d' | '30d' | '90d' | 'all';

function startDateFor(range: TimeRange): string | null {
	if (range === 'all') return null;
	const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
	const d = new Date();
	d.setDate(d.getDate() - days);
	return d.toISOString().slice(0, 10);
}

export function useModelUsage(range: TimeRange) {
	const [data, setData] = useState<ModelUsageRow[]>([]);
	const [loading, setLoading] = useState(true);
	const [total, setTotal] = useState<AggTotals>({ requests: 0, tokens_in: 0, tokens_out: 0, weighted_tokens: 0 });

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			setLoading(true);
			const { data: { user } } = await supabase.auth.getUser();
			if (!user || cancelled) { setLoading(false); return; }

			const startDate = startDateFor(range);
			let q = supabase.from('usage_daily_agg')
				.select('model_id, requests, tokens_in, tokens_out, weighted_tokens');
			if (startDate) q = q.gte('utc_date', startDate);
			// RLS scopes to own rows for non-admin; explicit filter reduces transfer
			q = q.eq('user_id', user.id);
			const { data: rows } = await q;
			if (cancelled) return;

			// group by model_id
			const map = new Map<string, AggTotals>();
			for (const r of rows ?? []) {
				const agg = map.get(r.model_id) ?? { requests: 0, tokens_in: 0, tokens_out: 0, weighted_tokens: 0 };
				agg.requests += r.requests ?? 0;
				agg.tokens_in += r.tokens_in ?? 0;
				agg.tokens_out += r.tokens_out ?? 0;
				agg.weighted_tokens += r.weighted_tokens ?? 0;
				map.set(r.model_id, agg);
			}

			// fetch model metadata
			const modelIds = [...map.keys()];
			let modelMap = new Map<string, { display_name: string; upstream_model_id: string; provider_id: string }>();
			if (modelIds.length) {
				const { data: models } = await supabase.from('models')
					.select('id, display_name, upstream_model_id, provider_id')
					.in('id', modelIds);
				for (const m of models ?? []) modelMap.set(m.id, m);
			}

			// check if admin — if so, fetch ALL users' data + provider names
			const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
			const isAdmin = profile?.role === 'admin';

			let providerMap = new Map<string, string>();
			let finalMap = map;

			if (isAdmin) {
				// re-fetch without user_id filter to get all data
				let aq = supabase.from('usage_daily_agg')
					.select('model_id, requests, tokens_in, tokens_out, weighted_tokens');
				if (startDate) aq = aq.gte('utc_date', startDate);
				const { data: allRows } = await aq;
				finalMap = new Map();
				for (const r of allRows ?? []) {
					const agg = finalMap.get(r.model_id) ?? { requests: 0, tokens_in: 0, tokens_out: 0, weighted_tokens: 0 };
					agg.requests += r.requests ?? 0;
					agg.tokens_in += r.tokens_in ?? 0;
					agg.tokens_out += r.tokens_out ?? 0;
					agg.weighted_tokens += r.weighted_tokens ?? 0;
					finalMap.set(r.model_id, agg);
				}

				// re-fetch model metadata for all models
				const allModelIds = [...finalMap.keys()];
				if (allModelIds.length) {
					const { data: models } = await supabase.from('models')
						.select('id, display_name, upstream_model_id, provider_id')
						.in('id', allModelIds);
					modelMap = new Map();
					for (const m of models ?? []) modelMap.set(m.id, m);
				}

				// fetch provider names
				const providerIds = [...new Set([...modelMap.values()].map((m) => m.provider_id))];
				if (providerIds.length) {
					const { data: providers } = await supabase.from('providers')
						.select('id, display_name')
						.in('id', providerIds);
					for (const p of providers ?? []) providerMap.set(p.id, p.display_name);
				}
			}

			const result: ModelUsageRow[] = [...finalMap.entries()].map(([modelId, agg]) => {
				const meta = modelMap.get(modelId);
				return {
					model_id: modelId,
					display_name: meta?.display_name ?? meta?.upstream_model_id ?? modelId.slice(0, 8),
					upstream_model_id: meta?.upstream_model_id ?? '—',
					provider_name: isAdmin ? providerMap.get(meta?.provider_id ?? '') : undefined,
					...agg,
				};
			}).sort((a, b) => b.weighted_tokens - a.weighted_tokens);

			const totals: AggTotals = { requests: 0, tokens_in: 0, tokens_out: 0, weighted_tokens: 0 };
			for (const r of result) {
				totals.requests += r.requests;
				totals.tokens_in += r.tokens_in;
				totals.tokens_out += r.tokens_out;
				totals.weighted_tokens += r.weighted_tokens;
			}

			setData(result);
			setTotal(totals);
			setLoading(false);
		})();
		return () => { cancelled = true; };
	}, [range]);

	return { data, loading, total };
}
