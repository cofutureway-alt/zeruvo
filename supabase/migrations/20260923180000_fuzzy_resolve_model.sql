-- ============================================================
-- FUZZY MODEL RESOLUTION: exact-match-only resolution 404'd on the
-- name variants real clients send — 'GLM-5.3-Flash' (no vendor prefix),
-- 'claude-opus-4-6' (hyphen vs dot), 'gpt-5.6-luna-free' (extra suffix)
-- — each logged as model_not_found 404 ("الموديل غير موجود").
--
-- Rules now:
--   1. exact string match always wins (branch 1)
--   2. when NO enabled row matches the exact string, fall back to a
--      normalized comparison (strip non-alphanumerics, lower) — covers
--      dot/hyphen/slash/prefix/suffix variants; request must compact to
--      >= 8 chars to avoid short-name false positives
--   3. ordering still prefers enabled > active-provider > non-custom,
--      so a disabled exact row yields to an ENABLED normalized twin
--      (glm-5-3-flash disabled → zai-org/GLM-5.3-Flash enabled), and a
--      truly-untouched disabled id still resolves to itself (model_disabled)
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
  where
    -- 1) exact match
    m.upstream_model_id = p_upstream_model
    -- 2) normalized fallback when no enabled exact row exists
    or (
      not exists (
        select 1 from public.models e
        where e.upstream_model_id = p_upstream_model and e.enabled_for_users
      )
      and length(regexp_replace(lower(coalesce(p_upstream_model, '')), '[^a-z0-9]', '', 'g')) >= 8
      and (
        position(regexp_replace(lower(m.upstream_model_id), '[^a-z0-9]', '', 'g')
                 in regexp_replace(lower(p_upstream_model), '[^a-z0-9]', '', 'g')) > 0
        or position(regexp_replace(lower(p_upstream_model), '[^a-z0-9]', '', 'g')
                 in regexp_replace(lower(m.upstream_model_id), '[^a-z0-9]', '', 'g')) > 0
      )
    )
  order by m.enabled_for_users desc,
           -- among candidates: exact string first, then compact-equal
           -- (dot/hyphen twins), then loose contains
           case when m.upstream_model_id = p_upstream_model then 0
                when regexp_replace(lower(m.upstream_model_id), '[^a-z0-9]', '', 'g')
                   = regexp_replace(lower(p_upstream_model), '[^a-z0-9]', '', 'g') then 1
                else 2 end,
           exists (select 1 from public.providers px
                   where px.id = coalesce(par.parent_provider_id, m.provider_id)
                     and px.status = 'active') desc,
           m.is_custom asc,
           m.usage_multiplier asc,
           m.created_at asc
  limit 1;
$$;

grant execute on function public.resolve_model_v2(text) to service_role;
revoke all on function public.resolve_model_v2(text) from public, anon, authenticated;

notify pgrst, 'reload schema';
