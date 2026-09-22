-- ============================================================
-- ALIAS WALLET/CATALOG follow-ups (from the alias audit):
--   1. auth_key_lookup: the plan→models join dropped hidden rows, so a
--      hidden parent was absent from allowed_models and the worker 403ed
--      BEFORE reserve_request (which admits hidden parents) decided
--      entitlement. The enabled check belongs in the gate (models
--      enabled_for_users), not here — remove it from the join.
--   2. is_priced in both catalog views: a custom alias whose only
--      entitlement is a plan that includes its PARENT computed as
--      is_priced=false and vanished from user catalogs/pickers. Count
--      parent-plan membership too.
-- ============================================================

create or replace function public.auth_key_lookup(p_key_hash text)
 returns table(api_key_id uuid, user_id uuid, user_status text, subscription_status text, plan_expires_at timestamptz, plan_daily_weighted bigint, allowed_models uuid[], api_allowed_models uuid[], rate_limit_per_min integer, wallet_balance_usd numeric, billing_preference text, spend_limit_usd numeric, total_spent_usd numeric, is_pending boolean)
 language sql stable security definer
 set search_path = 'public'
as $function$
  select k.id, k.user_id, pr.role,
         s.status,
         s.expires_at,
         pl.daily_weighted_tokens,
         coalesce(array_agg(m.id) filter (where m.id is not null), '{}'),
         k.allowed_models,
         k.rate_limit_per_min,
         coalesce(w.balance_usd, 0) + coalesce(w.offer_balance_usd, 0),
         pr.billing_preference,
         k.spend_limit_usd,
         k.total_spent_usd,
         (pr.github_created_at is not null
           and coalesce((select github_min_age_days from public.app_settings where id = 1), 0) > 0
           and pr.github_created_at + make_interval(days =>
                 (select github_min_age_days from public.app_settings where id = 1)) > now())
  from public.user_api_keys k
  join public.profiles pr        on pr.id = k.user_id
  left join public.wallets w     on w.user_id = k.user_id
  left join lateral (
    select * from public.subscriptions s2
    where s2.user_id = k.user_id and s2.status = 'active' and s2.expires_at > now()
    order by s2.expires_at desc limit 1
  ) s on true
  left join public.plans pl on pl.id = s.plan_id
  left join public.plan_models pm on pm.plan_id = s.plan_id
  left join public.models m on m.id = pm.model_id
  where k.sha256_hash = lower(p_key_hash)
    and k.status = 'active'
  group by k.id, k.user_id, pr.role, s.status, s.expires_at, pl.daily_weighted_tokens,
           k.allowed_models, k.rate_limit_per_min, w.balance_usd, w.offer_balance_usd,
           pr.billing_preference, k.spend_limit_usd, k.total_spent_usd, pr.github_created_at;
$function$;

revoke all on function public.auth_key_lookup(text) from public, anon, authenticated;
grant execute on function public.auth_key_lookup(text) to service_role;

-- public catalog view: enabled models only (anon+authenticated)
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
     where pm.model_id = m.id or (m.parent_model_id is not null and pm.model_id = m.parent_model_id))
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

-- admin view: same shape + provider columns, caller's RLS decides visibility
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
     where pm.model_id = m.id or (m.parent_model_id is not null and pm.model_id = m.parent_model_id))
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
