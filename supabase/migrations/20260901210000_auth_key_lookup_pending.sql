-- ============================================================
-- SECURITY FIX (HIGH — H4): pending GitHub users could call the API
-- The "pending" state (GitHub account too young) was enforced client-side
-- only (auth-context.tsx + guards.tsx). A pending user could craft a raw
-- curl request to the gateway with their API key and burn quota / get
-- responses directly — the server had no gate.
--
-- Fix: extend auth_key_lookup to return is_pending, and have the gateway
-- reject requests from pending users with 403.
-- ============================================================

-- Extend the auth_key_lookup function to also report pending state.
-- A user is pending if:
--   • they signed up via GitHub
--   • a github account age gate is configured (app_settings.github_min_age_days > 0)
--   • their github_created_at is set and is newer than (now - min_age_days)
create or replace function public.auth_key_lookup(p_key_hash text)
returns table (
  api_key_id uuid,
  user_id uuid,
  user_status text,
  subscription_status text,
  plan_expires_at timestamptz,
  plan_daily_weighted bigint,
  allowed_models uuid[],
  api_allowed_models uuid[],
  rate_limit_per_min int,
  is_pending boolean
)
language sql
security definer
set search_path = public
stable
as $$
  with key_row as (
    select k.id, k.user_id
    from public.user_api_keys k
    where k.sha256_hash = lower(p_key_hash) and k.status = 'active'
  ),
  gate as (
    select github_min_age_days from public.app_settings where id = 1
  ),
  is_pending_check as (
    select
      pr.github_created_at is not null
      and g.github_min_age_days > 0
      and (pr.github_created_at + (g.github_min_age_days || ' days')::interval) > now()
      as pending
    from key_row k
    join public.profiles pr on pr.id = k.user_id
    cross join gate g
  )
  select
    k.id,
    k.user_id,
    pr.role,
    s.status,
    s.expires_at,
    pl.daily_weighted_tokens,
    coalesce(array_agg(m.id) filter (where m.id is not null), '{}'),
    k.allowed_models,
    k.rate_limit_per_min,
    coalesce(ipc.pending, false)
  from key_row k
  join public.profiles pr        on pr.id = k.user_id
  left join lateral (
    select * from public.subscriptions s2
    where s2.user_id = k.user_id and s2.status = 'active' and s2.expires_at > now()
    order by s2.expires_at desc limit 1
  ) s on true
  left join public.plans pl on pl.id = s.plan_id
  left join public.plan_models pm on pm.plan_id = s.plan_id
  left join public.models m on m.id = pm.model_id and m.enabled_for_users
  left join is_pending_check ipc on true
  group by k.id, k.user_id, pr.role, s.status, s.expires_at, pl.daily_weighted_tokens, k.allowed_models, k.rate_limit_per_min, ipc.pending;
$$;

revoke all on function public.auth_key_lookup(text) from public, anon, authenticated;
