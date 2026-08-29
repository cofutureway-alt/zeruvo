-- ============================================================
-- Server-side signup gating (fixes: github_only mode still allowed
-- email signups because the UI hid the form but the API did not).
--
-- A BEFORE INSERT trigger on auth.users reads app_settings and:
--  - signup_mode = 'github_only' → reject users whose only identity is
--    email/password (provider 'email'). GitHub users pass.
--  - signup_mode = 'disabled'    → reject ALL new users.
-- ============================================================

create or replace function public.guard_signup_mode()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text;
  v_is_email_only boolean;
begin
  select signup_mode into v_mode from public.app_settings where id = 1;

  if v_mode is null or v_mode = 'email_and_github' then
    return new;
  end if;

  if v_mode = 'disabled' then
    raise exception 'Signups are currently closed'
      using errcode = 'P0001';
  end if;

  -- github_only: block email/password signups. A GitHub user has
  -- 'github' in raw_app_meta_data->providers; an email user has 'email'.
  v_is_email_only := coalesce(new.raw_app_meta_data->>'provider', '') = 'email'
    or (coalesce(new.raw_app_meta_data->'providers', '[]'::jsonb) ? 'email'
        and not coalesce(new.raw_app_meta_data->'providers', '[]'::jsonb) ? 'github');

  if v_is_email_only then
    raise exception 'New signups require a GitHub account'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_signup_guard on auth.users;
create trigger on_auth_user_signup_guard
before insert on auth.users
for each row execute function public.guard_signup_mode();
