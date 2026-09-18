-- ============================================================
-- SECURITY FIX (critical — reproduced live): "subscriptions: system write"
-- allowed `auth.uid() is null`, which is true for EVERY anonymous
-- PostgREST request. Anyone with the public anon key could INSERT an
-- arbitrary subscription row for any user_id → full paid access with no
-- payment (live probe returned 409 FK violation, proving RLS passed the
-- request through to constraint checks).
--
-- All legitimate write paths bypass RLS already:
--   • service_role clients (webhook, admin edge functions)
--   • SECURITY DEFINER trigger fn (default free plan on signup)
--   • table owner (no FORCE ROW LEVEL SECURITY anywhere)
-- so the null-uid branch served no purpose — only the attack.
--
-- Also: revoke direct DML from anon/authenticated as defense-in-depth;
-- admin UI writes go through the admin-users edge function (service role).
-- ============================================================

drop policy if exists "subscriptions: system write" on public.subscriptions;

-- INSERT: no direct policy at all. service_role bypasses RLS; the
-- signup trigger runs as table owner. Authenticated/anon users are denied.
revoke insert on public.subscriptions from anon, authenticated;
revoke update on public.subscriptions from anon, authenticated;
revoke delete on public.subscriptions from anon, authenticated;

-- UPDATE stays admin-only (was already is_admin(); kept explicit).
drop policy if exists "subscriptions: admin write" on public.subscriptions;
create policy "subscriptions: admin write" on public.subscriptions
  for update
  using (public.is_admin())
  with check (public.is_admin());
