-- Phase 8 hardening: tighten plans write policy (explicit with_check)
drop policy if exists "plans: admin write" on public.plans;
create policy "plans: admin write" on public.plans
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- Same tightening for other FOR ALL admin policies (defensive parity)
drop policy if exists "providers: admin write" on public.providers;
create policy "providers: admin write" on public.providers
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "models: admin write" on public.models;
create policy "models: admin write" on public.models
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "model_categories: admin write" on public.model_categories;
create policy "model_categories: admin write" on public.model_categories
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "announcements: admin write" on public.announcements;
create policy "announcements: admin write" on public.announcements
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "coupons: admin write" on public.coupons;
create policy "coupons: admin write" on public.coupons
  for all using (public.is_admin()) with check (public.is_admin());

-- subscriptions insert was intentionally open for service_role flows;
-- restrict it to security-definer paths only by requiring a real session or service role.
-- (service_role bypasses RLS, so this only closes the authenticated-user hole)
drop policy if exists "subscriptions: system write" on public.subscriptions;
create policy "subscriptions: system write" on public.subscriptions
  for insert
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
    or auth.uid() is null -- service role / definer contexts have no uid
  );
