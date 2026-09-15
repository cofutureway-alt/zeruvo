-- Cross-provider failover route chain.
--
-- resolve_model returns exactly ONE row per upstream_model_id (the primary:
-- enabled + cheapest). When that provider stalls or errors under load we want
-- to transparently retry the same model on another provider that serves it.
--
-- This returns every OTHER model row for the same upstream_model_id whose
-- provider is active, EXCLUDING the primary the Worker already resolved.
-- It deliberately includes enabled_for_users=false rows: those are routing
-- entries, not catalog entries — catalog visibility and plan gating stay on
-- the primary row. The Worker keeps billing identity (model_id, multiplier)
-- from the primary; a fallback only swaps provider_id/base_url/kind/keys.
create or replace function public.resolve_model_fallbacks(
  p_upstream_model text,
  p_exclude_model_id uuid
) returns table (
  model_id uuid,
  provider_id uuid,
  provider_kind text,
  provider_base_url text,
  usage_multiplier numeric,
  context_window int
)
language sql
security definer
set search_path = public
stable
as $$
  select m.id, m.provider_id, pr.kind, pr.base_url,
         m.usage_multiplier, m.context_window
  from public.models m
  join public.providers pr on pr.id = m.provider_id
  where m.upstream_model_id = p_upstream_model
    and m.id <> p_exclude_model_id
    and pr.status = 'active'
  order by m.created_at asc
  limit 8;
$$;

revoke all on function public.resolve_model_fallbacks(text, uuid)
  from public, anon, authenticated;
