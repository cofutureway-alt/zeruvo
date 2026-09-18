-- ============================================================
-- SECURITY FIX (critical): users can forge github_created_at.
-- The "profiles: self update" policy allows updating any column except
-- role/created_at — so a user can PATCH profiles with an old
-- github_created_at and instantly pass the GitHub account-age gate.
-- Block it two ways:
--   1) column-level: revoke UPDATE on that column from authenticated
--   2) trigger-level: reject any self-update that changes it
-- ============================================================

-- 1) Column-level revoke (Postgres supports column-scoped GRANTs)
revoke update on column public.profiles.github_created_at from authenticated;

-- 2) Belt & braces: trigger rejects self-updates touching the column.
--    service_role bypasses RLS but not triggers — so the trigger must
--    allow through only the service-role/definer path that legitimately
--    writes the column (the OAuth capture flow).
create or replace function public.guard_github_age()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.github_created_at is distinct from old.github_created_at then
    -- security definer runs as the table owner, so auth.uid() is null for
    -- service-role writes; a normal user session always has an id here.
    if auth.uid() is not null and auth.uid() = new.id then
      raise exception 'github_created_at is system-managed';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_github_age_update on public.profiles;
create trigger guard_github_age_update
before update on public.profiles
for each row execute function public.guard_github_age();
