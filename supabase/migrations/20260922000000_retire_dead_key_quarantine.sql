-- ============================================================
-- RETIRE the dead-key quarantine mechanism (admin decision: keys are
-- never taken out of rotation). The gateway no longer marks keys dead;
-- every attempt picks fresh from the provider's full key set.
--   1. get_provider_keys: no dead_until in the shape
--   2. drop mark_provider_key_dead / revive_provider_key
--   3. provider_keys: drop dead_until + last_error_code columns
-- ============================================================

drop function if exists public.get_provider_keys(uuid);

create or replace function public.get_provider_keys(p_provider_id uuid)
returns table (
  id uuid,
  provider_id uuid,
  encrypted_key text,
  weight numeric
)
language sql
security definer
set search_path = public
stable
as $$
  select k.id, k.provider_id, k.encrypted_key, k.weight
  from public.provider_keys k
  join public.providers p on p.id = k.provider_id
  where k.provider_id = p_provider_id
    and p.status = 'active';
$$;

revoke all on function public.get_provider_keys(uuid) from public, anon, authenticated;
grant execute on function public.get_provider_keys(uuid) to service_role;

drop function if exists public.mark_provider_key_dead(uuid, timestamptz);
drop function if exists public.revive_provider_key(uuid);

alter table public.provider_keys drop column if exists dead_until;
alter table public.provider_keys drop column if exists last_error_code;

notify pgrst, 'reload schema';
