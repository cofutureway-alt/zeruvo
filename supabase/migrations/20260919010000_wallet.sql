-- ============================================================
-- WALLET — USD credit balance for Pay-As-You-Go usage.
--  - wallets: balance + reservation hold (same pattern as quota)
--  - wallet_transactions: immutable ledger (topup/usage/admin/refund)
--  - app_settings: top-up bounds + Google/Firebase + Turnstile config
--  - private_settings: admin-only encrypted secrets (Turnstile secret)
--  - profiles.billing_preference: plan-first vs wallet-first toggle
-- ============================================================

create table public.wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  balance_usd numeric(12,6) not null default 0 check (balance_usd >= 0),
  reserved_usd numeric(12,6) not null default 0 check (reserved_usd >= 0),
  updated_at timestamptz not null default now()
);
create index wallets_balance_idx on public.wallets (balance_usd) where balance_usd > 0;
alter table public.wallets enable row level security;
create policy "wallets: owner read" on public.wallets
  for select using (user_id = auth.uid() or public.is_admin());
-- writes only via security-definer RPCs / service_role

create table public.wallet_transactions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('topup','usage','refund','admin_grant','admin_deduct')),
  amount_usd numeric(12,6) not null,          -- signed: + credit, - debit
  balance_after numeric(12,6) not null,
  payment_id uuid references public.payments(id),
  note text,
  created_at timestamptz not null default now()
);
create index wallet_tx_user_idx on public.wallet_transactions (user_id, created_at desc);
alter table public.wallet_transactions enable row level security;
create policy "wallet_tx: owner read" on public.wallet_transactions
  for select using (user_id = auth.uid() or public.is_admin());

-- ---------- wallet RPCs (called by webhook / admin functions) ----------
create or replace function public.wallet_credit(
  p_user_id uuid,
  p_amount_usd numeric,
  p_kind text default 'topup',
  p_payment_id uuid default null,
  p_note text default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric(12,6);
begin
  if p_amount_usd is null or p_amount_usd <= 0 then
    raise exception 'WALLET_AMOUNT_POSITIVE';
  end if;

  insert into public.wallets (user_id, balance_usd)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;

  select w.balance_usd into v_balance
  from public.wallets w
  where w.user_id = p_user_id
  for update;                                  -- serialize concurrent credits

  v_balance := round(v_balance + p_amount_usd, 6);

  update public.wallets
  set balance_usd = v_balance, updated_at = now()
  where user_id = p_user_id;

  insert into public.wallet_transactions
    (user_id, kind, amount_usd, balance_after, payment_id, note)
  values
    (p_user_id, p_kind, p_amount_usd, v_balance, p_payment_id, p_note);

  return v_balance;
end;
$$;

create or replace function public.wallet_admin_adjust(
  p_user_id uuid,
  p_amount_usd numeric,                        -- signed: + grant / - deduct
  p_note text default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric(12,6);
begin
  if p_amount_usd is null or p_amount_usd = 0 then
    raise exception 'WALLET_AMOUNT_NONZERO';
  end if;

  insert into public.wallets (user_id, balance_usd)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;

  select w.balance_usd into v_balance
  from public.wallets w
  where w.user_id = p_user_id
  for update;

  if v_balance + p_amount_usd < 0 then
    raise exception 'WALLET_INSUFFICIENT';
  end if;

  v_balance := round(v_balance + p_amount_usd, 6);
  update public.wallets
  set balance_usd = v_balance, updated_at = now()
  where user_id = p_user_id;

  insert into public.wallet_transactions
    (user_id, kind, amount_usd, balance_after, note)
  values
    (p_user_id, case when p_amount_usd > 0 then 'admin_grant' else 'admin_deduct' end,
     p_amount_usd, v_balance, p_note);

  return v_balance;
end;
$$;

revoke all on function public.wallet_credit(uuid,numeric,text,uuid,text) from public, anon, authenticated;
revoke all on function public.wallet_admin_adjust(uuid,numeric,text) from public, anon, authenticated;
grant execute on function public.wallet_credit(uuid,numeric,text,uuid,text) to service_role;
grant execute on function public.wallet_admin_adjust(uuid,numeric,text) to service_role;

-- ---------- app_settings: wallet bounds + google + turnstile ----------
alter table public.app_settings
  add column if not exists wallet_min_topup_usd numeric(12,2) not null default 10,
  add column if not exists wallet_max_topup_usd numeric(12,2) not null default 200,
  add column if not exists wallet_quick_amounts numeric[] not null default '{10,25,50,100,200}',
  add column if not exists google_auth_enabled boolean not null default false,
  add column if not exists firebase_config jsonb not null default '{}';

-- Turnstile secret must NOT live in the publicly-readable app_settings —
-- encrypted AES-GCM, admin-only table, read by edge functions via service_role.
create table public.private_settings (
  key text primary key,
  value_encrypted text not null,
  updated_at timestamptz not null default now()
);
alter table public.private_settings enable row level security;
create policy "private_settings: admin" on public.private_settings
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- billing preference toggle (plan-first ↔ wallet-first) ----------
alter table public.profiles
  add column if not exists billing_preference text
    not null default 'plan_first'
    check (billing_preference in ('plan_first','wallet_first'));
