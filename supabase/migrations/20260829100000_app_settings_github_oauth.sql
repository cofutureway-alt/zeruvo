-- ============================================================
-- App-wide auth/signup settings + GitHub-account age gate.
-- 1) app_settings: singleton row (id=1) admin controls the signup
--    mode and the minimum age a GitHub account must have.
-- 2) profiles.github_created_at: the date the user's GitHub account
--    was created (captured at OAuth time; GitHub does not expose it
--    through Supabase metadata).
-- ============================================================

create table public.app_settings (
  id smallint primary key default 1 check (id = 1),
  signup_mode text not null default 'email_and_github'
    check (signup_mode in ('email_and_github','github_only','disabled')),
  github_min_age_days int not null default 0 check (github_min_age_days >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

-- anyone (incl. unauthenticated) may read the mode — the signup / login
-- pages need to know which mode to render before the user signs in.
create policy "app_settings: public read" on public.app_settings
  for select using (true);

-- only admins may change the mode / age threshold.
create policy "app_settings: admin write" on public.app_settings
  for all using (public.is_admin()) with check (public.is_admin());

insert into public.app_settings (id) values (1) on conflict (id) do nothing;

-- GitHub account creation date, captured from the GitHub API at OAuth time.
alter table public.profiles
  add column if not exists github_created_at timestamptz;
