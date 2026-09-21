-- ============================================================
-- ADMIN PROVIDER COLUMNS: the admin models table had no way to see
-- or change which gateway provider (providers row) serves a model —
-- vendor_slug is the catalog brand, not the connection. Add
-- provider_id / provider_name / provider_kind to models_admin_view.
-- ============================================================

drop view if exists public.models_admin_view;
create view public.models_admin_view
with (security_invoker = true) as
select
  m.id, m.slug, m.display_name, m.description, m.context_window,
  m.upstream_model_id, m.usage_multiplier, m.enabled_for_users,
  m.payg_enabled, m.tags, m.vendor_slug, m.quality_score, m.is_featured,
  m.is_custom, m.parent_model_id,
  m.input_modalities, m.output_modalities,
  m.supports_reasoning, m.supports_effort, m.max_output_tokens,
  m.input_price_per_m, m.output_price_per_m,
  m.cache_read_price_per_m, m.cache_write_price_per_m,
  v.display_name as vendor_name, v.icon_key as vendor_icon,
  pr.display_name as provider_name, pr.kind as provider_kind,
  m.provider_id,
  ep.input_price, ep.output_price, ep.cache_read_price, ep.cache_write_price,
  ep.discount_percent,
  (m.payg_enabled or m.usage_multiplier > 1 or exists (
     select 1 from public.plan_models pm
     join public.plans p on p.id = pm.plan_id and p.active
     where pm.model_id = m.id)
  ) as is_priced,
  st.tok_per_s, st.avg_ttft_ms, st.requests_30d
from public.models m
left join public.ai_providers v on v.slug = m.vendor_slug
left join public.providers pr on pr.id = m.provider_id
cross join lateral public.effective_model_prices(m.id) ep
left join lateral (
  select avg(case when l.latency_ms > 0 and l.tokens_out > 0
                 then l.tokens_out * 1000.0 / l.latency_ms end)::numeric(10,1) as tok_per_s,
         avg(l.ttft_ms) filter (where l.ttft_ms > 0)::numeric(10,1) as avg_ttft_ms,
         count(*)::int as requests_30d
  from public.request_logs l
  where l.model_id = m.id and l.created_at > now() - interval '30 days'
) st on true;

grant select on public.models_admin_view to authenticated;

notify pgrst, 'reload schema';
