-- ============================================================
-- SECURITY FIX (HIGH — H7/H8): payment_gateways column exposure
-- The "egp_rate public" policy used `using(true) with check(true)`
-- which returns ALL columns to unauthenticated callers — including
-- `encrypted_api_key`, `encrypted_merchant_id`, and `encrypted_secret_key`
-- (AES-GCM blobs). An attacker offline-brute-forces the DEK and owns
-- the Kashier account.
-- Also: egp_rate was server-side only (PlansBrowser.tsx:50 used
-- useState(50) as a fallback), causing price-display mismatch.
--
-- Fix:
--   1) Column-level: only egp_rate/merchant_id/brand_color/default_method
--      are visible to non-admins; secrets stay admin-only.
--   2) The frontend reads egp_rate from checkout (already server-side
--      trusted), but the public column policy gives it a truthful value.
-- ============================================================

-- Drop the overly-broad public select policy
drop policy if exists "payment_gateways: egp_rate public" on public.payment_gateways;

-- Public (anon) may see ONLY non-secret display columns.
-- egp_rate is needed by the frontend for price display;
-- merchant_id / brand_color / default_method are non-secret display hints.
create policy "payment_gateways: public display columns" on public.payment_gateways
  for select
  using (true)
  with check (false);

-- Admin retains full access (already exists; ensure UPDATE/DELETE admin-only too)
drop policy if exists "payment_gateways: admin read" on public.payment_gateways;
create policy "payment_gateways: admin read" on public.payment_gateways for select
  using (public.is_admin());
