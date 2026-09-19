-- ============================================================
-- RATE LIMITS — per-model RPM/RPH/RPD/TPM + global defaults +
-- durable fixed-window counters + per-key USD spend limit.
-- ============================================================

create table public.model_rate_limits (
  model_id uuid primary key references public.models(id) on delete cascade,
  rpm int  check (rpm  is null or rpm  > 0),   -- requests / minute
  rph int  check (rph  is null or rph  > 0),   -- requests / hour
  rpd int  check (rpd  is null or rpd  > 0),   -- requests / day
  tpm bigint check (tpm is null or tpm > 0),   -- tokens   / minute
  updated_at timestamptz not null default now()
);
alter table public.model_rate_limits enable row level security;
create policy "model_rate_limits: read" on public.model_rate_limits for select using (true);
create policy "model_rate_limits: admin write" on public.model_rate_limits
  for all using (public.is_admin()) with check (public.is_admin());

-- Global defaults: applied to every model that has no explicit row.
-- A NULL column = that window is unlimited by default.
create table public.rate_limit_defaults (
  id smallint primary key default 1 check (id = 1),
  rpm int  check (rpm  is null or rpm  > 0),
  rph int  check (rph  is null or rph  > 0),
  rpd int  check (rpd  is null or rpd  > 0),
  tpm bigint check (tpm is null or tpm > 0),
  updated_at timestamptz not null default now()
);
alter table public.rate_limit_defaults enable row level security;
create policy "rate_limit_defaults: admin" on public.rate_limit_defaults
  for all using (public.is_admin()) with check (public.is_admin());

insert into public.rate_limit_defaults (id) values (1) on conflict (id) do nothing;

-- Durable fixed-window counters, keyed e.g. 'm:{model}:rpm:{epoch_minute}'.
create table public.rate_counters (
  key text primary key,
  count bigint not null default 0,
  window_start timestamptz not null,
  bumped_at timestamptz not null default now()
);
alter table public.rate_counters enable row level security;
-- no policies: only the security-definer reserve_request touches it

create or replace function public.prune_rate_counters()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.rate_counters
  where window_start < now() - interval '2 days';
$$;

revoke all on function public.prune_rate_counters() from public, anon, authenticated;

select cron.schedule('nexor-rate-counter-prune', '40 0 * * *', $$select public.prune_rate_counters()$$)
where not exists (
  select 1 from cron.job where jobname = 'nexor-rate-counter-prune'
);

-- ---------- per-key USD spend limit (empty = unlimited) ----------
alter table public.user_api_keys
  add column if not exists spend_limit_usd numeric(12,2)
    check (spend_limit_usd is null or spend_limit_usd >= 0),
  add column if not exists total_spent_usd numeric(12,4) not null default 0;
