-- ============================================================
-- SECURITY FIX (critical): profile self-update privilege escalation
-- The old "profiles: self update" policy allowed updating ANY column
-- including `role`, so any user could promote themselves to admin via
-- a direct PATCH on profiles. Self-updates are now restricted to
-- non-privileged columns through a trigger, and the policy itself no
-- longer grants blanket column access.
-- ============================================================

drop policy if exists "profiles: self update" on public.profiles;
drop policy if exists "profiles: admin update role" on public.profiles;

-- Users may update only their own row, and never role/created_at.
create policy "profiles: self update"
on public.profiles
for update
using (id = auth.uid())
with check (
  id = auth.uid()
  and role = (select p.role from public.profiles p where p.id = auth.uid())
  and created_at = (select p.created_at from public.profiles p where p.id = auth.uid())
);

-- Admins may update anything on anyone.
create policy "profiles: admin update all"
on public.profiles
for update
using (public.is_admin())
with check (public.is_admin());

-- Belt & braces: trigger blocks role changes outside service_role,
-- and prevents demoting/banning the LAST admin.
create or replace function public.guard_profile_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_count int;
begin
  -- role changes are only allowed by service_role (webhook/functions)
  -- or by admins editing OTHER admins' rows; a self-edit can't touch role
  if new.role <> old.role then
    if auth.uid() = new.id then
      raise exception 'cannot change own role';
    end if;
    -- if DEMOTING an existing admin, ensure another admin remains
    if old.role = 'admin' and new.role = 'user' then
      select count(*) into v_admin_count
      from public.profiles where role = 'admin' and id <> old.id;
      if v_admin_count = 0 then
        raise exception 'cannot demote the last admin';
      end if;
    end if;
  end if;

  -- deleting the last admin is blocked at the DB level too
  return new;
end;
$$;

drop trigger if exists guard_profiles_update on public.profiles;
create trigger guard_profiles_update
before update on public.profiles
for each row execute function public.guard_profile_changes();

create or replace function public.guard_profile_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_count int;
begin
  if old.role = 'admin' then
    select count(*) into v_admin_count
    from public.profiles where role = 'admin' and id <> old.id;
    if v_admin_count = 0 then
      raise exception 'cannot delete the last admin';
    end if;
  end if;
  return old;
end;
$$;

drop trigger if exists guard_profiles_delete on public.profiles;
create trigger guard_profiles_delete
before delete on public.profiles
for each row execute function public.guard_profile_delete();
