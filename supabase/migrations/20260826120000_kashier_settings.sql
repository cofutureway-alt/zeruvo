-- ============================================================
-- Zeruvo AI — Phase 5: payment gateway settings (admin-configurable)
-- ============================================================

create table public.payment_gateways (
  id uuid primary key default gen_random_uuid(),
  gateway text not null unique check (gateway in ('kashier')),
  enabled boolean not null default false,
  mode text not null default 'test' check (mode in ('test','live')),
  -- credentials stored encrypted (AES-GCM, same DEK as provider keys)
  encrypted_merchant_id text,     -- not secret but kept uniform; readable label for admin UI
  merchant_id text,               -- MID shown in plain to admin (not a secret)
  encrypted_api_key text,
  encrypted_secret_key text,
  allowed_methods text[] not null default '{card,wallet,fawry}',
  default_method text not null default 'card',
  brand_color text not null default '#6366f1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.payment_gateways enable row level security;
create policy "payment_gateways: admin read" on public.payment_gateways for select
  using (public.is_admin());
create policy "payment_gateways: admin write" on public.payment_gateways for all
  using (public.is_admin()) with check (public.is_admin());
