-- ============================================================
-- Nexor AI — Phase 2: gateway Worker RPCs
-- service_role-only helpers for key retrieval + dead marking.
-- ============================================================

-- Return provider keys for a provider (ciphertext; decrypted inside Worker)
create or replace function public.get_provider_keys(p_provider_id uuid)
returns table (
  id uuid,
  provider_id uuid,
  encrypted_key text,
  weight numeric,
  dead_until timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select k.id, k.provider_id, k.encrypted_key, k.weight, k.dead_until
  from public.provider_keys k
  join public.providers p on p.id = k.provider_id
  where k.provider_id = p_provider_id
    and p.status = 'active';
$$;

revoke all on function public.get_provider_keys(uuid) from public, anon, authenticated;

create or replace function public.mark_provider_key_dead(p_key_id uuid, p_dead_until timestamptz)
returns void
language sql
security definer
set search_path = public
as $$
  update public.provider_keys
  set dead_until = p_dead_until
  where id = p_key_id;
$$;

revoke all on function public.mark_provider_key_dead(uuid,timestamptz) from public, anon, authenticated;

-- Resolve upstream model -> provider row + multiplier + context window in one call.
-- Accepts "upstream_model_id" as sent by the client (e.g. "anthropic/claude-sonnet-4").
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
    and m.slug = p_upstream_model -- slug mirrors upstream id by default
  limit 1;
$$;

revoke all on function public.resolve_model(text) from public, anon, authenticated;
