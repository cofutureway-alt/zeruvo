-- ============================================================
-- Nexor AI — Phase 1: core schema, RLS, atomic quota RPCs, cron
-- ============================================================
-- Conventions:
--  * Every table has RLS. Owner-scoped reads via auth.uid().
--    Admin bypass via is_admin() (SECURITY DEFINER, STABLE).
--  * service_role bypasses RLS; used ONLY inside Edge Functions / Worker RPC.
--  * Money: price_usd numeric(12,2). Weighted tokens: bigint.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- profiles ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'user' check (role in ('admin','user')),
  locale text not null default 'en' check (locale in ('en','ar','fr','zh')),
  theme text not null default 'dark' check (theme in ('dark','light')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- ---------- helpers (after profiles table exists) ----------
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

create policy "profiles: self read" on public.profiles
  for select using (id = auth.uid() or public.is_admin());
create policy "profiles: self update" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());
create policy "profiles: admin update role" on public.profiles
  for update using (public.is_admin());

-- Auto-provision profile + assign default free plan on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_default_plan uuid;
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;

  select id into v_default_plan
  from public.plans
  where default_free = true and is_free = true
  order by created_at asc
  limit 1;

  if v_default_plan is not null then
    insert into public.subscriptions
      (user_id, plan_id, started_at, expires_at, status)
    select
      new.id,
      v_default_plan,
      now(),
      now() + make_interval(
        days   => case when p.duration_unit = 'days'   then p.duration_count else 0 end,
        months => case when p.duration_unit = 'months' then p.duration_count else 0 end,
        years  => case when p.duration_unit = 'years'  then p.duration_count else 0 end),
      'active'
    from public.plans p
    where p.id = v_default_plan;
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------- providers ----------
create table public.providers (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('custom','openrouter')),
  display_name text not null,
  base_url text not null,
  status text not null default 'active' check (status in ('active','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.providers enable row level security;
-- readable by any client of the gateway UI; writable by admins only
create policy "providers: read" on public.providers for select using (true);
create policy "providers: admin write" on public.providers for all
  using (public.is_admin()) with check (public.is_admin());

-- ---------- provider keys (AES-GCM ciphertext; never plaintext) ----------
create table public.provider_keys (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete cascade,
  label text not null default 'key',
  encrypted_key text not null,          -- base64(nonce||ciphertext), AES-256-GCM
  weight numeric(6,2) not null default 1 check (weight > 0),
  dead_until timestamptz,               -- set on 401/402/403, rotated on 429
  last_error_code int,
  created_at timestamptz not null default now()
);
alter table public.provider_keys enable row level security;
create policy "provider_keys: admin" on public.provider_keys for all
  using (public.is_admin()) with check (public.is_admin());
-- gateway Worker accesses via service_role only

-- ---------- model categories ----------
create table public.model_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  icon_url text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.model_categories enable row level security;
create policy "model_categories: read" on public.model_categories for select using (true);
create policy "model_categories: admin write" on public.model_categories for all
  using (public.is_admin()) with check (public.is_admin());

-- ---------- models ----------
create table public.models (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete cascade,
  category_id uuid references public.model_categories(id) on delete set null,
  upstream_model_id text not null,      -- e.g. "anthropic/claude-sonnet-4"
  display_name text not null,
  context_window int,
  usage_multiplier numeric(10,2) not null default 1 check (usage_multiplier >= 1),
  enabled_for_users boolean not null default false,
  tags text[] not null default '{}',
  slug text not null unique,            -- public SEO page: /[locale]/models/[slug]
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_id, upstream_model_id)
);
create index models_enabled_idx on public.models (enabled_for_users) where enabled_for_users;
alter table public.models enable row level security;
create policy "models: read" on public.models for select using (true);
create policy "models: admin write" on public.models for all
  using (public.is_admin()) with check (public.is_admin());

-- ---------- plans ----------
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  name jsonb not null,                  -- localized {en,ar,fr,zh}
  description jsonb not null default '{}',
  daily_weighted_tokens bigint not null check (daily_weighted_tokens > 0),
  price_usd numeric(12,2) not null default 0,
  duration_unit text not null check (duration_unit in ('days','months','years')),
  duration_count int not null check (duration_count > 0),
  is_free boolean not null default false,
  default_free boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.plans enable row level security;
create policy "plans: read active" on public.plans for select using (active = true);
create policy "plans: admin write" on public.plans for all
  using (public.is_admin()) with check (public.is_admin());

-- only one default free plan
create unique index plans_one_default_free
  on public.plans ((1)) where default_free;

create table public.plan_models (
  plan_id uuid not null references public.plans(id) on delete cascade,
  model_id uuid not null references public.models(id) on delete cascade,
  primary key (plan_id, model_id)
);
alter table public.plan_models enable row level security;
create policy "plan_models: read" on public.plan_models for select using (true);
create policy "plan_models: admin write" on public.plan_models for all
  using (public.is_admin()) with check (public.is_admin());

-- ---------- discounts ----------
create table public.discounts (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid references public.plans(id) on delete cascade, -- null = all plans
  percent_off numeric(5,2) not null check (percent_off between 0 and 100),
  valid_from timestamptz not null,
  valid_to timestamptz not null,
  usage_limit int,
  times_used int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (valid_to > valid_from)
);
alter table public.discounts enable row level security;
create policy "discounts: read valid" on public.discounts for select
  using (active = true and now() between valid_from and valid_to);
create policy "discounts: admin write" on public.discounts for all
  using (public.is_admin()) with check (public.is_admin());

-- ---------- subscriptions ----------
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan_id uuid not null references public.plans(id),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'active' check (status in ('active','expired','canceled'))
);
create index subscriptions_user_active_idx on public.subscriptions (user_id, status);
alter table public.subscriptions enable row level security;
create policy "subscriptions: owner read" on public.subscriptions for select
  using (user_id = auth.uid() or public.is_admin());
create policy "subscriptions: system write" on public.subscriptions for insert
  with check (true);  -- writes happen via security definer funcs / webhook / service_role
create policy "subscriptions: admin write" on public.subscriptions for update
  using (public.is_admin());

-- ---------- daily usage (quota engine) ----------
create table public.daily_usage (
  user_id uuid not null references public.profiles(id) on delete cascade,
  utc_date date not null,
  reserved_weighted bigint not null default 0,
  consumed_weighted bigint not null default 0,
  primary key (user_id, utc_date)
);
alter table public.daily_usage enable row level security;
create policy "daily_usage: owner read" on public.daily_usage for select
  using (user_id = auth.uid() or public.is_admin());
-- writes only via RPC/service_role

-- ---------- user API keys (hash-only) ----------
create table public.user_api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null default 'default',
  prefix text not null,                 -- first chars for UI display, e.g. sk-nexor-abcd
  last4 text not null,
  sha256_hash text not null unique,     -- hex SHA-256 of full key; constant-time lookup path
  allowed_models uuid[] not null default '{}', -- empty = all plan models
  rate_limit_per_min int not null default 60,
  status text not null default 'active' check (status in ('active','revoked')),
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.user_api_keys enable row level security;
create policy "user_api_keys: owner" on public.user_api_keys for all
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid());

-- ---------- payments ----------
create sequence payment_invoice_seq start 1000;

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount_egp numeric(12,2) not null,
  amount_usd_display numeric(12,2) not null,
  method text not null,                 -- card|fawry|wallet|applepay...
  gateway text not null default 'kashier',
  gateway_ref text not null unique,     -- Kashier transactionReference; replay guard
  invoice_no text not null unique default ('INV-' || nextval('payment_invoice_seq')::text),
  status text not null default 'pending' check (status in ('pending','paid','failed','refunded')),
  coupon_code text,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.payments enable row level security;
create policy "payments: owner read" on public.payments for select
  using (user_id = auth.uid() or public.is_admin());
-- inserts via checkout/webhook service_role only

-- ---------- coupons ----------
create table public.coupons (
  code text primary key,
  percent_off numeric(5,2) not null check (percent_off between 0 and 100),
  valid_from timestamptz not null,
  valid_to timestamptz not null,
  max_redemptions int not null default 1,
  times_redeemed int not null default 0,
  active boolean not null default true
);
alter table public.coupons enable row level security;
create policy "coupons: validate" on public.coupons for select
  using (active = true and now() between valid_from and valid_to);
create policy "coupons: admin write" on public.coupons for all
  using (public.is_admin()) with check (public.is_admin());

create table public.coupon_redemptions (
  coupon_code text not null references public.coupons(code),
  user_id uuid not null references public.profiles(id) on delete cascade,
  payment_id uuid references public.payments(id),
  redeemed_at timestamptz not null default now(),
  primary key (coupon_code, user_id)
);
alter table public.coupon_redemptions enable row level security;
create policy "coupon_redemptions: owner read" on public.coupon_redemptions for select
  using (user_id = auth.uid() or public.is_admin());
-- writes via service_role at checkout success

-- ---------- announcements ----------
create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('popup','marquee')),
  placement_routes text[] not null default '{*}', -- ['*'] = everywhere
  audience_type text not null default 'everyone'
    check (audience_type in ('everyone','anonymous','logged_in','plans')),
  plan_ids uuid[] not null default '{}',
  media_type text not null default 'button' check (media_type in ('image','youtube','button')),
  image_url text,
  youtube_id text,
  body_text jsonb not null default '{}',  -- localized marquee/popup text
  cta_label jsonb not null default '{}',
  cta_url text,
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.announcements enable row level security;
create policy "announcements: read active" on public.announcements for select using (active = true);
create policy "announcements: admin write" on public.announcements for all
  using (public.is_admin()) with check (public.is_admin());

-- ---------- request logs ----------
create table public.request_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  api_key_id uuid,
  model_id uuid,
  upstream_model text not null,
  tokens_in bigint not null default 0,
  tokens_out bigint not null default 0,
  cache_read_tokens bigint not null default 0,
  weighted_tokens bigint not null default 0,
  latency_ms int not null default 0,
  status int not null,                  -- HTTP-ish status we returned
  error_code text,
  created_at timestamptz not null default now()
);
create index request_logs_user_time_idx on public.request_logs (user_id, created_at desc);
create index request_logs_model_time_idx on public.request_logs (model_id, created_at desc);
alter table public.request_logs enable row level security;
create policy "request_logs: owner read" on public.request_logs for select
  using (user_id = auth.uid() or public.is_admin());
-- inserts via service_role (Worker settle call)

-- aggregated history (kept forever, tiny)
create table public.usage_daily_agg (
  user_id uuid not null,
  model_id uuid not null default '00000000-0000-0000-0000-000000000000'::uuid,
  utc_date date not null,
  requests int not null default 0,
  tokens_in bigint not null default 0,
  tokens_out bigint not null default 0,
  weighted_tokens bigint not null default 0,
  primary key (user_id, model_id, utc_date)
);
alter table public.usage_daily_agg enable row level security;
create policy "usage_daily_agg: owner read" on public.usage_daily_agg for select
  using (user_id = auth.uid() or public.is_admin());

-- ---------- audit logs ----------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  admin_id uuid not null references public.profiles(id),
  action text not null,
  target_table text not null,
  target_id text,
  diff jsonb,
  created_at timestamptz not null default now()
);
alter table public.audit_logs enable row level security;
create policy "audit_logs: admin read" on public.audit_logs for select using (public.is_admin());
-- writes via admin-api service_role

-- ============================================================
-- ATOMIC QUOTA ENGINE (called by gateway Worker via PostgREST RPC)
-- ============================================================

-- Resolve an incoming sk-nexor-* key to user+plan+allowance in one shot
create or replace function public.auth_key_lookup(p_key_hash text)
returns table (
  api_key_id uuid,
  user_id uuid,
  user_status text,
  subscription_status text,
  plan_expires_at timestamptz,
  plan_daily_weighted bigint,
  allowed_models uuid[],
  api_allowed_models uuid[],
  rate_limit_per_min int
)
language sql
security definer
set search_path = public
stable
as $$
  select k.id, k.user_id, pr.role,
         s.status,
         s.expires_at,
         pl.daily_weighted_tokens,
         coalesce(array_agg(m.id) filter (where m.id is not null), '{}'),
         k.allowed_models,
         k.rate_limit_per_min
  from public.user_api_keys k
  join public.profiles pr        on pr.id = k.user_id
  left join lateral (
    select * from public.subscriptions s2
    where s2.user_id = k.user_id and s2.status = 'active' and s2.expires_at > now()
    order by s2.expires_at desc limit 1
  ) s on true
  left join public.plans pl on pl.id = s.plan_id
  left join public.plan_models pm on pm.plan_id = s.plan_id
  left join public.models m on m.id = pm.model_id and m.enabled_for_users
  where k.sha256_hash = lower(p_key_hash)
    and k.status = 'active'
  group by k.id, k.user_id, pr.role, s.status, s.expires_at, pl.daily_weighted_tokens, k.allowed_models, k.rate_limit_per_min;
$$;

revoke all on function public.auth_key_lookup(text) from public, anon, authenticated;

-- Atomic reserve: FOR UPDATE prevents concurrent double-spend.
-- Returns new reserved total, or raises exception 'QUOTA_EXCEEDED'.
create or replace function public.reserve_quota(
  p_user_id uuid,
  p_estimate_weighted bigint,
  p_today date default (now() at time zone 'utc')::date
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reserved bigint;
  v_allowance bigint;
begin
  -- allowance from the caller's active plan
  select s_plan.daily_weighted_tokens into v_allowance
  from public.subscriptions s
  join public.plans s_plan on s_plan.id = s.plan_id
  where s.user_id = p_user_id and s.status='active' and s.expires_at > now()
  order by s.expires_at desc limit 1;

  if v_allowance is null then
    raise exception 'NO_ACTIVE_PLAN';
  end if;

  insert into public.daily_usage (user_id, utc_date, reserved_weighted, consumed_weighted)
  values (p_user_id, p_today, 0, 0)
  on conflict (user_id, utc_date) do nothing;

  select du.reserved_weighted into v_reserved
  from public.daily_usage du
  where du.user_id = p_user_id and du.utc_date = p_today
  for update;                          -- serializes concurrent reserves

  if v_reserved + p_estimate_weighted > v_allowance then
    raise exception 'QUOTA_EXCEEDED';
  end if;

  update public.daily_usage
  set reserved_weighted = reserved_weighted + p_estimate_weighted
  where user_id = p_user_id and utc_date = p_today;

  return v_reserved + p_estimate_weighted;
end;
$$;

revoke all on function public.reserve_quota(uuid,bigint,date) from public, anon, authenticated;

-- Settle after completion: consumed += actual, release unused reservation
create or replace function public.settle_quota(
  p_user_id uuid,
  p_reserved_amount bigint,
  p_actual_weighted bigint,
  p_log jsonb default null,
  p_today date default (now() at time zone 'utc')::date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.daily_usage
  set reserved_weighted = greatest(reserved_weighted - p_reserved_amount, 0)
                        + p_actual_weighted,
      consumed_weighted = consumed_weighted + p_actual_weighted
  where user_id = p_user_id and utc_date = p_today;

  insert into public.daily_usage
    (user_id, utc_date, reserved_weighted, consumed_weighted)
  values (p_user_id, p_today, 0, p_actual_weighted)
  on conflict (user_id, utc_date) do nothing;

  if p_log is not null then
    insert into public.request_logs
      (user_id, api_key_id, model_id, upstream_model, tokens_in, tokens_out,
       cache_read_tokens, weighted_tokens, latency_ms, status, error_code)
    values (
      p_user_id,
      (p_log->>'api_key_id')::uuid,
      (p_log->>'model_id')::uuid,
      coalesce(p_log->>'upstream_model','unknown'),
      coalesce((p_log->>'tokens_in')::bigint, 0),
      coalesce((p_log->>'tokens_out')::bigint, 0),
      coalesce((p_log->>'cache_read_tokens')::bigint, 0),
      p_actual_weighted,
      coalesce((p_log->>'latency_ms')::int, 0),
      coalesce((p_log->>'status')::int, 200),
      p_log->>'error_code'
    );
  end if;
end;
$$;

revoke all on function public.settle_quota(uuid,bigint,bigint,jsonb,date) from public, anon, authenticated;

-- Expire subscriptions whose time is up (hard block decision point)
create or replace function public.expire_subscriptions()
returns void
language sql
security definer
set search_path = public
as $$
  update public.subscriptions
  set status = 'expired'
  where status = 'active' and expires_at <= now();
$$;

revoke all on function public.expire_subscriptions() from public, anon, authenticated;

-- ============================================================
-- pg_cron jobs (free tier supports pg_cron)
-- ============================================================
create extension if not exists pg_cron;

select cron.schedule('nexor-daily-reset', '0 * * * *', $$
  select case
    when extract(hour from now() at time zone 'utc') = 0
    then public.expire_subscriptions()::text
    else 'skip'
  end
$$);

select cron.schedule('nexor-expire-hourly', '5 * * * *', $$select public.expire_subscriptions()$$);

-- Retention: keep request_logs 60 days (500MB budget), aggregate first
create or replace function public.archive_and_prune_logs()
returns void
language sql
security definer
set search_path = public
as $$
  with agg as (
    insert into public.usage_daily_agg
      (user_id, model_id, utc_date, requests, tokens_in, tokens_out, weighted_tokens)
    select user_id, coalesce(model_id, '00000000-0000-0000-0000-000000000000'::uuid),
           created_at::date,
           count(*), sum(tokens_in), sum(tokens_out), sum(weighted_tokens)
    from public.request_logs
    where created_at < now() - interval '60 days'
    group by user_id, coalesce(model_id, '00000000-0000-0000-0000-000000000000'::uuid), created_at::date
    on conflict (user_id, model_id, utc_date)
    do update set
      requests = public.usage_daily_agg.requests + excluded.requests,
      tokens_in = public.usage_daily_agg.tokens_in + excluded.tokens_in,
      tokens_out = public.usage_daily_agg.tokens_out + excluded.tokens_out,
      weighted_tokens = public.usage_daily_agg.weighted_tokens + excluded.weighted_tokens
    returning 1
  )
  delete from public.request_logs
  where created_at < now() - interval '60 days';
$$;

revoke all on function public.archive_and_prune_logs() from public, anon, authenticated;

select cron.schedule('nexor-log-prune-daily', '30 0 * * *', $$select public.archive_and_prune_logs()$$);
