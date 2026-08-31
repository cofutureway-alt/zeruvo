-- Fix resolve_model: the same upstream_model_id can exist on multiple
-- providers (synced from each). The old query had no ORDER BY, so LIMIT 1
-- picked an arbitrary row — often a DISABLED duplicate from another
-- provider, which made live models fail with "Model not available".
--
-- Now it prefers enabled rows from active providers, then picks the
-- cheapest multiplier as a deterministic tiebreak.
create or replace function public.resolve_model(p_upstream_model text)
returns table (
  model_id uuid,
  provider_id uuid,
  provider_kind text,
  provider_base_url text,
  usage_multiplier numeric,
  context_window int,
  enabled boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select m.id, m.provider_id, pr.kind, pr.base_url,
         m.usage_multiplier, m.context_window, m.enabled_for_users
  from public.models m
  join public.providers pr on pr.id = m.provider_id
  where m.upstream_model_id = p_upstream_model
  order by
    m.enabled_for_users desc,          -- enabled rows win over disabled dupes
    (pr.status = 'active') desc,       -- active providers win over disabled
    m.usage_multiplier asc,            -- deterministic: cheapest first
    m.created_at asc
  limit 1;
$$;

revoke all on function public.resolve_model(text) from public, anon, authenticated;
