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
	return d.toISOString();
}

/**
 * Most-used models for the caller (or everyone, for admins).
 *
 * Reads request_logs directly — usage_daily_agg only fills from the
 * nightly archive job after logs pass 60 days, so querying it alone
 * showed an empty "most used" table for the first two months. Rows older
 * than the 60-day retention live only in usage_daily_agg, so both
 * sources are merged.
 */
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

			const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
			const isAdmin = profile?.role === 'admin';
			const startDate = startDateFor(range);

			const merge = (map: Map<string, AggTotals>, rows: Array<{ model_id: string | null; requests: number | null; tokens_in: number | null; tokens_out: number | null; weighted_tokens: number | null }> | null) => {
				for (const r of rows ?? []) {
					const key = r.model_id ?? '00000000-0000-0000-0000-000000000000';
					const agg = map.get(key) ?? { requests: 0, tokens_in: 0, tokens_out: 0, weighted_tokens: 0 };
					agg.requests += r.requests ?? 0;
					agg.tokens_in += r.tokens_in ?? 0;
					agg.tokens_out += r.tokens_out ?? 0;
					agg.weighted_tokens += r.weighted_tokens ?? 0;
					map.set(key, agg);
				}
			};

			const map = new Map<string, AggTotals>();

			// fresh data: request_logs (last 60 days of traffic)
			{
				let q = supabase.from('request_logs').select('model_id, tokens_in, tokens_out, weighted_tokens');
				if (startDate) q = q.gte('created_at', startDate);
				if (!isAdmin) q = q.eq('user_id', user.id);
				const { data: rows } = await q;
				if (cancelled) return;
				merge(map, (rows ?? []).map((r) => ({
					model_id: (r as { model_id?: string | null }).model_id ?? null,
					requests: 1,
					tokens_in: Number((r as { tokens_in?: number }).tokens_in ?? 0),
					tokens_out: Number((r as { tokens_out?: number }).tokens_out ?? 0),
					weighted_tokens: Number((r as { weighted_tokens?: number }).weighted_tokens ?? 0),
				})) as never);
			}

			// archived data: usage_daily_agg (older than retention)
			{
				let q = supabase.from('usage_daily_agg').select('model_id, requests, tokens_in, tokens_out, weighted_tokens');
				if (startDate) q = q.gte('utc_date', startDate.slice(0, 10));
				if (!isAdmin) q = q.eq('user_id', user.id);
				const { data: rows } = await q;
				if (cancelled) return;
				merge(map, rows as never);
			}

			// model + provider metadata
			const modelIds = [...map.keys()].filter((id) => id !== '00000000-0000-0000-0000-000000000000');
			const modelMap = new Map<string, { display_name: string; upstream_model_id: string; provider_id: string }>();
			if (modelIds.length) {
				const { data: models } = await supabase.from('models')
					.select('id, display_name, upstream_model_id, provider_id')
					.in('id', modelIds);
				for (const m of models ?? []) modelMap.set(m.id, m);
			}
			const providerMap = new Map<string, string>();
			const providerIds = [...new Set([...modelMap.values()].map((m) => m.provider_id))];
			if (isAdmin && providerIds.length) {
				const { data: providers } = await supabase.from('providers')
					.select('id, display_name')
					.in('id', providerIds);
				for (const p of providers ?? []) providerMap.set(p.id, p.display_name);
			}

			const result: ModelUsageRow[] = [...map.entries()].map(([modelId, agg]) => {
				const meta = modelMap.get(modelId);
				return {
					model_id: modelId,
					display_name: meta?.display_name ?? meta?.upstream_model_id ?? (modelId === '00000000-0000-0000-0000-000000000000' ? 'Unknown / deleted' : modelId.slice(0, 8)),
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

			if (cancelled) return;
			setData(result);
			setTotal(totals);
			setLoading(false);
		})();
		return () => { cancelled = true; };
	}, [range]);

	return { data, loading, total };
}
