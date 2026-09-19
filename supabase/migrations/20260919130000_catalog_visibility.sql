-- ============================================================
-- CATALOG VISIBILITY (audit follow-up): the "unpriced/hidden models
-- are admin-only" rule was cosmetic — models_public_view and the
-- models/providers tables were anon-readable via direct PostgREST,
-- exposing hidden models, upstream ids and provider base_urls.
--
--   1. models SELECT: only enabled rows for non-admins
--   2. models_public_view: rebuilt WITH WHERE enabled_for_users
--      (all public consumers already filter to enabled rows)
--   3. models_admin_view: security_invoker copy for the admin table —
--      admins see everything (RLS), others see enabled only
--   4. providers SELECT: admin-only (base_url is infrastructure info;
--      no anon consumer exists — the marketing marquee is a static list)
-- ============================================================

-- 1) models row visibility
drop policy if exists "models: read" on public.models;
create policy "models: read" on public.models
  for select using (enabled_for_users = true or public.is_admin());

-- 2) public view: enabled models only
drop view if exists public.models_public_view;
create view public.models_public_view as
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
cross join lateral public.effective_model_prices(m.id) ep
left join lateral (
  select avg(case when l.latency_ms > 0 and l.tokens_out > 0
                 then l.tokens_out * 1000.0 / l.latency_ms end)::numeric(10,1) as tok_per_s,
         avg(l.ttft_ms) filter (where l.ttft_ms > 0)::numeric(10,1) as avg_ttft_ms,
         count(*)::int as requests_30d
  from public.request_logs l
  where l.model_id = m.id and l.created_at > now() - interval '30 days'
) st on true
where m.enabled_for_users;

grant select on public.models_public_view to anon, authenticated;

-- 3) admin view: same shape, caller's RLS decides row visibility
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

-- 4) providers are admin-only now
drop policy if exists "providers: read" on public.providers;
create policy "providers: admin read" on public.providers
  for select using (public.is_admin());

notify pgrst, 'reload schema';
