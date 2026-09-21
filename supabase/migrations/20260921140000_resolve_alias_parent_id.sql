-- ============================================================
-- CUSTOM-MODEL (ALIAS) BILLING GATE: a custom model is a fake public
-- name for a base model (e.g. CLAUDE-OPUS-4.8 -> GLM-5.3-Flash on dahl).
-- resolve_model_v2 resolves the alias to its parent's provider/upstream,
-- but the gateway's plan/key gates checked the ALIAS row's id — which no
-- plan lists — so every alias call was rejected as model_not_in_plan.
-- Return parent_model_id so the gate can check the REAL served model.
-- service_role-only RPC (gateway worker is the sole caller).
-- ============================================================

drop function if exists public.resolve_model_v2(text);
create function public.resolve_model_v2(p_upstream_model text)
returns table (
  model_id uuid,
  provider_id uuid,
  provider_kind text,
  provider_base_url text,
  upstream_id text,
  parent_model_id uuid,
  usage_multiplier numeric,
  context_window integer,
  enabled boolean,
  system_prompt text,
  payg_enabled boolean,
  price_in numeric,
  price_out numeric,
  price_cache_read numeric,
  price_cache_write numeric,
  discount_percent numeric,
  display_name text,
  vendor_slug text
)
language sql stable
as $$
  select
    m.id,
    coalesce(par.parent_provider_id, m.provider_id),
    coalesce(par.parent_provider_kind, mp.kind),
    coalesce(par.parent_provider_base_url, mp.base_url),
    coalesce(par.parent_upstream_id, m.upstream_model_id),
    m.parent_model_id,
    m.usage_multiplier,
    m.context_window,
    m.enabled_for_users,
    case when m.is_custom then m.system_prompt end,
    m.payg_enabled,
    ep.input_price, ep.output_price, ep.cache_read_price, ep.cache_write_price,
    ep.discount_percent,
    m.display_name,
    m.vendor_slug
  from public.models m
  join public.providers mp on mp.id = m.provider_id
  left join lateral (
    select pm2.upstream_model_id  as parent_upstream_id,
           pp.id                  as parent_provider_id,
           pp.kind                as parent_provider_kind,
           pp.base_url            as parent_provider_base_url
    from public.models pm2
    join public.providers pp on pp.id = pm2.provider_id
    where pm2.id = m.parent_model_id
  ) par on m.is_custom
  cross join lateral public.effective_model_prices(m.id) ep
  where m.upstream_model_id = p_upstream_model
  order by m.enabled_for_users desc,
           exists (select 1 from public.providers px
                   where px.id = coalesce(par.parent_provider_id, m.provider_id)
                     and px.status = 'active') desc,
           m.is_custom asc,
           m.usage_multiplier asc,
           m.created_at asc
  limit 1;
$$;

revoke all on function public.resolve_model_v2(text) from public, anon, authenticated;
grant execute on function public.resolve_model_v2(text) to service_role;

notify pgrst, 'reload schema';
