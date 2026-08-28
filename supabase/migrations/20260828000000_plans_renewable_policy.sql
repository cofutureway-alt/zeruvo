-- ============================================================
-- Plans: renewable flag + user visibility that keeps current
-- subscribers able to see (and renew) even a hidden plan.
-- ============================================================

alter table public.plans
  add column if not exists renewable boolean not null default true;

comment on column public.plans.renewable is
  'Whether current active subscribers may renew this plan (even if active=false).';

-- Replace the old "plans: read active" policy: a user may read a plan if
-- it is active (shown in the catalog) OR if they currently hold an active
-- subscription to it (so hidden/soft-deleted plans stay visible + renewable
-- for existing subscribers). Admins keep full access via the admin policy.
drop policy if exists "plans: read active" on public.plans;
create policy "plans: read active or subscribed" on public.plans
  for select
  using (
    active = true
    or exists (
      select 1 from public.subscriptions s
      where s.plan_id = public.plans.id
        and s.user_id = auth.uid()
        and s.status = 'active'
        and s.expires_at > now()
    )
  );
