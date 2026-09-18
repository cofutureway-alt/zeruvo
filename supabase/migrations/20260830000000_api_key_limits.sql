-- ============================================================
-- SECURITY FIX: Limit active API keys per user to 2
-- Users may have unlimited revoked keys, but only 2 active keys
-- maximum. Revocation doesn't count toward the limit.
-- Keys can be permanently deleted (removed from all lists).
-- ============================================================

-- Function to enforce 2 active keys limit + clamp rate_limit abuse.
-- Direct PostgREST inserts are allowed by RLS (used by probes), so a user
-- could otherwise set rate_limit_per_min = 999999 and bypass plan limits —
-- the gateway reads this column straight from the table.
create or replace function public.validate_active_api_keys()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active_count int;
begin
  -- Clamp the per-key rate limit to the same ceiling the Edge Function uses
  if NEW.rate_limit_per_min is null or NEW.rate_limit_per_min <= 0 then
    NEW.rate_limit_per_min := 60;
  elsif NEW.rate_limit_per_min > 600 then
    NEW.rate_limit_per_min := 600;
  end if;

  -- Only enforce the count when a key becomes/stays active
  if NEW.status = 'active' then
    select count(*) into v_active_count
    from public.user_api_keys
    where user_id = NEW.user_id
      and status = 'active'
      and id <> NEW.id;

    if v_active_count >= 2 then
      raise exception 'Each user is limited to 2 active API keys'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

-- Trigger to enforce the limit
drop trigger if exists enforce_active_api_keys_limit on public.user_api_keys;
create trigger enforce_active_api_keys_limit
before insert or update on public.user_api_keys
for each row execute function public.validate_active_api_keys();

-- ============================================================
-- Split the blanket "for all" policy into per-command policies:
-- owners get SELECT/INSERT/UPDATE; DELETE is reserved for admins.
-- Permanent deletion by users goes through delete_api_key() so
-- every hard-delete lands in audit_logs.
-- ============================================================

drop policy if exists "user_api_keys: owner" on public.user_api_keys;

create policy "user_api_keys: owner select" on public.user_api_keys
  for select
  using (user_id = auth.uid() or public.is_admin());

create policy "user_api_keys: owner insert" on public.user_api_keys
  for insert
  with check (user_id = auth.uid());

create policy "user_api_keys: owner update" on public.user_api_keys
  for update
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid());

create policy "user_api_keys: admin delete" on public.user_api_keys
  for delete
  using (public.is_admin());

-- ============================================================
-- Allow permanent deletion of API keys
-- Soft-delete via status='revoked'; hard-delete removes the row
-- entirely so hidden/revoked keys can't linger forever.
-- Users may only delete their OWN keys (enforced in WHERE).
-- ============================================================

create or replace function public.delete_api_key(p_key_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int;
begin
  delete from public.user_api_keys
  where id = p_key_id
    and user_id = p_user_id;

  get diagnostics v_deleted = row_count;

  if v_deleted > 0 then
    insert into public.audit_logs (admin_id, action, target_table, target_id, diff)
    values (p_user_id, 'delete_api_key', 'user_api_keys', p_key_id::text,
            '{"status": "permanently_deleted"}'::jsonb);
  end if;

  return v_deleted > 0;
end;
$$;

revoke all on function public.delete_api_key(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_api_key(uuid, uuid) to authenticated, service_role;

-- ============================================================
-- View for users to see their keys (only active keys shown)
-- ============================================================

drop view if exists public.user_api_keys_view;
create view public.user_api_keys_view
with (security_invoker = true) as
select
  id,
  user_id,
  name,
  prefix,
  last4,
  allowed_models,
  rate_limit_per_min,
  status,
  last_used_at,
  created_at
from public.user_api_keys
where status = 'active';

grant select on public.user_api_keys_view to authenticated;
