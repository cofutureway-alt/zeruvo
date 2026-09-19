-- ============================================================
-- Google sign-in gating: the signup-mode guard now also enforces the
-- admin-configured google_auth_enabled flag (Google via Firebase).
-- Existing behavior for email/GitHub is unchanged.
-- ============================================================

create or replace function public.guard_signup_mode()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text;
  v_google_ok boolean;
  v_providers jsonb;
  v_provider text;
begin
  select signup_mode into v_mode from public.app_settings where id = 1;
  select google_auth_enabled into v_google_ok from public.app_settings where id = 1;

  v_provider := coalesce(new.raw_app_meta_data->>'provider', '');
  v_providers := coalesce(new.raw_app_meta_data->'providers', '[]'::jsonb);

  -- Google (via Firebase ID token) requires the admin flag
  if (v_provider = 'google' or v_providers ? 'google') and coalesce(v_google_ok, false) = false then
    raise exception 'Google sign-in is currently disabled'
      using errcode = 'P0001';
  end if;

  if v_mode is null or v_mode = 'email_and_github' then
    return new;
  end if;

  if v_mode = 'disabled' then
    raise exception 'Signups are currently closed'
      using errcode = 'P0001';
  end if;

  -- github_only: block email/password signups (GitHub & enabled Google pass)
  if v_provider = 'email' or (v_providers ? 'email' and not v_providers ? 'github') then
    raise exception 'New signups require a GitHub account'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;
