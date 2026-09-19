-- ============================================================
-- BILLING ENGINE v2 — dual-mode billing (plan quota | wallet PAYG).
--  - request_logs/usage_daily_agg: cost_usd, billing_mode, cache write, TTFT
--  - auth_key_lookup: + wallet, preference, spend limit (replaced in place)
--  - resolve_model_v2: routing + effective prices + custom models
--  - bump_counter: fixed-window durable rate counters
--  - reserve_request: atomic rate-limit check + mode decision + reservation
--  - settle_usage: settle plan quota OR debit wallet, single request_logs row
-- Also fixes migration 20260826120000 which used invalid `add_column`
-- syntax (subscriptions.cancelled_at may never have been created).
-- ============================================================

alter table public.subscriptions add column if not exists cancelled_at timestamptz;

-- ---------- usage log columns ----------
alter table public.request_logs
  add column if not exists cost_usd numeric(12,6) not null default 0,
  add column if not exists billing_mode text not null default 'plan'
    check (billing_mode in ('plan','wallet')),
  add column if not exists cache_write_tokens bigint not null default 0,
  add column if not exists ttft_ms int;

alter table public.usage_daily_agg
  add column if not exists cost_usd numeric(14,6) not null default 0;

create or replace function public.archive_and_prune_logs()
returns void
language sql
security definer
set search_path = public
as $$
  with agg as (
    insert into public.usage_daily_agg
      (user_id, model_id, utc_date, requests, tokens_in, tokens_out, weighted_tokens, cost_usd)
    select user_id, coalesce(model_id, '00000000-0000-0000-0000-000000000000'::uuid),
           created_at::date,
           count(*), sum(tokens_in), sum(tokens_out), sum(weighted_tokens), sum(cost_usd)
    from public.request_logs
    where created_at < now() - interval '60 days'
    group by user_id, coalesce(model_id, '00000000-0000-0000-0000-000000000000'::uuid), created_at::date
    on conflict (user_id, model_id, utc_date)
    do update set
      requests = public.usage_daily_agg.requests + excluded.requests,
      tokens_in = public.usage_daily_agg.tokens_in + excluded.tokens_in,
      tokens_out = public.usage_daily_agg.tokens_out + excluded.tokens_out,
      weighted_tokens = public.usage_daily_agg.weighted_tokens + excluded.weighted_tokens,
      cost_usd = public.usage_daily_agg.cost_usd + excluded.cost_usd
    returning 1
  )
  delete from public.request_logs
  where created_at < now() - interval '60 days';
$$;

-- ---------- auth key lookup: + wallet & spend-limit context ----------
-- return shape changes → the old function must go first
drop function if exists public.auth_key_lookup(text);

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
  rate_limit_per_min int,
  wallet_balance_usd numeric,
  billing_preference text,
  spend_limit_usd numeric,
  total_spent_usd numeric,
  is_pending boolean
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
         k.rate_limit_per_min,
         w.balance_usd,
         pr.billing_preference,
         k.spend_limit_usd,
         k.total_spent_usd,
         (pr.github_created_at is not null
           and coalesce((select github_min_age_days from public.app_settings where id = 1), 0) > 0
           and pr.github_created_at + make_interval(days =>
                 (select github_min_age_days from public.app_settings where id = 1)) > now())
  from public.user_api_keys k
  join public.profiles pr        on pr.id = k.user_id
  left join public.wallets w     on w.user_id = k.user_id
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
  group by k.id, k.user_id, pr.role, s.status, s.expires_at, pl.daily_weighted_tokens,
           k.allowed_models, k.rate_limit_per_min, w.balance_usd, pr.billing_preference,
           k.spend_limit_usd, k.total_spent_usd, pr.github_created_at;
$$;

revoke all on function public.auth_key_lookup(text) from public, anon, authenticated;

-- ---------- model resolution v2 ----------
-- Matches the PUBLIC id the client sends (custom models resolve to their
-- parent's provider/upstream id + system prompt). Prices are effective
-- (after active discounts).
create or replace function public.resolve_model_v2(p_upstream_model text)
returns table (
  model_id uuid,
  provider_id uuid,
  provider_kind text,
  provider_base_url text,
  upstream_id text,
  usage_multiplier numeric,
  context_window int,
  enabled boolean,
  system_prompt text,
  payg_enabled boolean,
  price_in numeric,
  price_out numeric,
  price_cache_read numeric,
  price_cache_write numeric,
  discount_percent numeric,
  display_name text,
  vendor_slug text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    m.id,
    coalesce(par.parent_provider_id, m.provider_id),
    coalesce(par.parent_provider_kind, mp.kind),
    coalesce(par.parent_provider_base_url, mp.base_url),
    coalesce(par.parent_upstream_id, m.upstream_model_id),
    m.usage_multiplier,
    m.context_window,
    m.enabled_for_users,
    case when m.is_custom then m.system_prompt end,
    m.payg_enabled,
    ep.input_price, ep.output_price, ep.cache_read_price, ep.cache_write_price,
    ep.discount_percent,
    m.display_name,
    m.vendor_slug
  from public.models m
  join public.providers mp on mp.id = m.provider_id
  left join lateral (
    select pm2.upstream_model_id  as parent_upstream_id,
           pp.id                  as parent_provider_id,
           pp.kind                as parent_provider_kind,
           pp.base_url            as parent_provider_base_url
    from public.models pm2
    join public.providers pp on pp.id = pm2.provider_id
    where pm2.id = m.parent_model_id
  ) par on m.is_custom
  cross join lateral public.effective_model_prices(m.id) ep
  where m.upstream_model_id = p_upstream_model
  order by m.enabled_for_users desc,
           exists (select 1 from public.providers px
                   where px.id = coalesce(par.parent_provider_id, m.provider_id)
                     and px.status = 'active') desc,
           m.is_custom asc,
           m.usage_multiplier asc,
           m.created_at asc
  limit 1;
$$;

revoke all on function public.resolve_model_v2(text) from public, anon, authenticated;

-- ---------- durable rate counters ----------
create or replace function public.bump_counter(
  p_key text,
  p_amount bigint,
  p_limit bigint,
  p_field text            -- 'minute' | 'hour' | 'day'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start timestamptz := date_trunc(p_field, now());
  v_counter text := p_key || ':' || (extract(epoch from v_start)::bigint)::text;
begin
  insert into public.rate_counters (key, count, window_start)
  values (v_counter, 0, v_start)
  on conflict (key) do nothing;

  update public.rate_counters
  set count = count + p_amount, bumped_at = now()
  where key = v_counter and count + p_amount <= p_limit;

  if not found then
    raise exception 'MODEL_RATE_LIMITED:%', p_key;
  end if;
end;
$$;

revoke all on function public.bump_counter(text,bigint,bigint,text) from public, anon, authenticated;

-- ---------- atomic reservation: rate limits + mode + hold ----------
create or replace function public.reserve_request(
  p_user_id uuid,
  p_api_key_id uuid,
  p_model_id uuid,
  p_est_tokens_in bigint,
  p_est_tokens_out bigint,
  p_today date default (now() at time zone 'utc')::date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_model record;
  v_lim record;
  v_sub record;
  v_pref text;
  v_key record;
  v_plan_models uuid[];
  v_can_plan boolean;
  v_can_wallet boolean;
  v_mode text;
  v_est_weighted bigint;
  v_est_cost numeric(12,6);
  v_allowance bigint;
  v_reserved bigint;
  v_balance numeric(12,6);
  v_hold_resv numeric(12,6);
begin
  -- ---- model + effective prices ----
  select m.usage_multiplier, m.enabled_for_users, m.payg_enabled,
         ep.input_price, ep.output_price
  into v_model
  from public.models m
  cross join lateral public.effective_model_prices(m.id) ep
  where m.id = p_model_id;
  if not found then
    raise exception 'MODEL_NOT_FOUND';
  end if;

  -- ---- rate limits (model row overrides global defaults; NULL = off) ----
  select coalesce(rl.rpm,  d.rpm)  as rpm,
         coalesce(rl.rph,  d.rph)  as rph,
         coalesce(rl.rpd,  d.rpd)  as rpd,
         coalesce(rl.tpm,  d.tpm)  as tpm
  into v_lim
  from public.rate_limit_defaults d
  left join public.model_rate_limits rl on rl.model_id = p_model_id
  where d.id = 1;

  -- per-user-per-model windows: one heavy customer cannot starve others
  if v_lim.rpm is not null then
    perform public.bump_counter('mu:' || p_model_id || ':' || p_user_id || ':rpm', 1, v_lim.rpm, 'minute');
  end if;
  if v_lim.rph is not null then
    perform public.bump_counter('mu:' || p_model_id || ':' || p_user_id || ':rph', 1, v_lim.rph, 'hour');
  end if;
  if v_lim.rpd is not null then
    perform public.bump_counter('mu:' || p_model_id || ':' || p_user_id || ':rpd', 1, v_lim.rpd, 'day');
  end if;
  if v_lim.tpm is not null then
    perform public.bump_counter('mu:' || p_model_id || ':' || p_user_id || ':tpm',
                                p_est_tokens_in + p_est_tokens_out, v_lim.tpm, 'minute');
  end if;

  -- ---- entitlements ----
  select s.plan_id, pl.daily_weighted_tokens
  into v_sub
  from public.subscriptions s
  join public.plans pl on pl.id = s.plan_id
  where s.user_id = p_user_id and s.status = 'active' and s.expires_at > now()
  order by s.expires_at desc limit 1;

  select billing_preference into v_pref from public.profiles where id = p_user_id;

  v_can_plan := v_sub.plan_id is not null and v_model.enabled_for_users;
  if v_can_plan then
    select coalesce(array_agg(pm.model_id), '{}') into v_plan_models
    from public.plan_models pm where pm.plan_id = v_sub.plan_id;
    if coalesce(array_length(v_plan_models, 1), 0) > 0
       and not (p_model_id = any (v_plan_models)) then
      v_can_plan := false;
    end if;
  end if;

  v_can_wallet := v_model.payg_enabled
    and (v_model.input_price is not null or v_model.output_price is not null);

  if coalesce(v_pref, 'plan_first') = 'wallet_first' then
    v_mode := case when v_can_wallet then 'wallet' when v_can_plan then 'plan' else null end;
  else
    v_mode := case when v_can_plan then 'plan' when v_can_wallet then 'wallet' else null end;
  end if;

  if v_mode is null then
    if v_sub.plan_id is null then
      raise exception 'NO_ACTIVE_PLAN';
    end if;
    raise exception 'MODEL_NOT_INCLUDED';
  end if;

  -- ---- plan path: weighted-token quota ----
  if v_mode = 'plan' then
    v_allowance := v_sub.daily_weighted_tokens;
    insert into public.daily_usage (user_id, utc_date, reserved_weighted, consumed_weighted)
    values (p_user_id, p_today, 0, 0)
    on conflict (user_id, utc_date) do nothing;

    select du.reserved_weighted into v_reserved
    from public.daily_usage du
    where du.user_id = p_user_id and du.utc_date = p_today
    for update;

    v_est_weighted := ceil((p_est_tokens_in + p_est_tokens_out) * v_model.usage_multiplier);
    -- cap speculative reservations at 20% of the day (settlement bills actual)
    v_est_weighted := least(v_est_weighted, ceil(v_allowance * 0.2));

    if v_reserved + v_est_weighted > v_allowance then
      raise exception 'QUOTA_EXCEEDED';
    end if;

    update public.daily_usage
    set reserved_weighted = reserved_weighted + v_est_weighted
    where user_id = p_user_id and utc_date = p_today;

    return jsonb_build_object('mode', 'plan', 'reserved_weighted', v_est_weighted,
                              'hold_usd', 0, 'multiplier', v_model.usage_multiplier);
  end if;

  -- ---- wallet path: USD hold against the balance ----
  -- micro-dollar ceiling so holds never round in the merchant's favor
  v_est_cost := ceil(
      coalesce(v_model.input_price, 0)  * p_est_tokens_in
    + coalesce(v_model.output_price, 0) * p_est_tokens_out
  ) / 1000000.0;

  select spend_limit_usd, total_spent_usd into v_key
  from public.user_api_keys where id = p_api_key_id;
  if v_key.spend_limit_usd is not null
     and v_key.total_spent_usd + v_est_cost > v_key.spend_limit_usd then
    raise exception 'SPEND_LIMIT_REACHED';
  end if;

  select w.balance_usd, w.reserved_usd into v_balance, v_hold_resv
  from public.wallets w
  where w.user_id = p_user_id
  for update;

  if v_balance is null or v_balance - v_hold_resv < v_est_cost then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  update public.wallets
  set reserved_usd = reserved_usd + v_est_cost, updated_at = now()
  where user_id = p_user_id;

  return jsonb_build_object('mode', 'wallet', 'reserved_weighted', 0,
                            'hold_usd', v_est_cost);
end;
$$;

revoke all on function public.reserve_request(uuid,uuid,uuid,bigint,bigint,date)
  from public, anon, authenticated;

-- ---------- settlement: plan quota OR wallet debit + request log ----------
create or replace function public.settle_usage(
  p_user_id uuid,
  p_api_key_id uuid default null,    -- falls back to p_log->>'api_key_id'
  p_mode text = 'plan',              -- 'plan' | 'wallet'
  p_hold_usd numeric default 0,
  p_reserved_weighted bigint default 0,
  p_actual_weighted bigint default 0,
  p_actual_cost_usd numeric default 0,
  p_log jsonb default null,
  p_today date default (now() at time zone 'utc')::date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric(12,6);
  v_reserved numeric(12,6);
  v_hold numeric(12,6);
  v_cost numeric(12,6);
  v_new_balance numeric(12,6);
  v_debt numeric(12,6) := 0;
  v_key_id uuid := coalesce(p_api_key_id, nullif(p_log->>'api_key_id', '')::uuid);
begin
  v_cost := greatest(coalesce(p_actual_cost_usd, 0), 0);

  if p_mode = 'wallet' then
    v_hold := greatest(coalesce(p_hold_usd, 0), 0);

    select w.balance_usd, w.reserved_usd into v_balance, v_reserved
    from public.wallets w where w.user_id = p_user_id for update;

    if v_balance is not null then
      v_new_balance := round(v_balance - v_cost, 6);
      if v_new_balance < 0 then
        -- actual spend exceeded the estimate hold (client sent no max_tokens):
        -- bill what exists, forgive the remainder — never go negative
        v_debt := -v_new_balance;
        v_new_balance := 0;
      end if;

      update public.wallets
      set balance_usd = v_new_balance,
          reserved_usd = greatest(reserved_usd - v_hold, 0),
          updated_at = now()
      where user_id = p_user_id;

      insert into public.wallet_transactions (user_id, kind, amount_usd, balance_after, note)
      values (p_user_id, 'usage', -v_cost, v_new_balance,
              case when v_debt > 0 then 'debt_forgiven:' || v_debt::text end);

      update public.user_api_keys
      set total_spent_usd = total_spent_usd + v_cost
      where id = v_key_id;
    end if;
  else
    -- plan mode: same accounting as settle_quota
    update public.daily_usage
    set reserved_weighted = greatest(reserved_weighted - p_reserved_weighted, 0) + p_actual_weighted,
        consumed_weighted = consumed_weighted + p_actual_weighted
    where user_id = p_user_id and utc_date = p_today;

    insert into public.daily_usage (user_id, utc_date, reserved_weighted, consumed_weighted)
    values (p_user_id, p_today, 0, p_actual_weighted)
    on conflict (user_id, utc_date) do nothing;
  end if;

  if p_log is not null then
    insert into public.request_logs
      (user_id, api_key_id, model_id, upstream_model, tokens_in, tokens_out,
       cache_read_tokens, cache_write_tokens, weighted_tokens, cost_usd,
       billing_mode, latency_ms, ttft_ms, status, error_code)
    values (
      p_user_id,
      (p_log->>'api_key_id')::uuid,
      (p_log->>'model_id')::uuid,
      coalesce(p_log->>'upstream_model','unknown'),
      coalesce((p_log->>'tokens_in')::bigint, 0),
      coalesce((p_log->>'tokens_out')::bigint, 0),
      coalesce((p_log->>'cache_read_tokens')::bigint, 0),
      coalesce((p_log->>'cache_write_tokens')::bigint, 0),
      p_actual_weighted,
      case when p_mode = 'wallet' then v_cost else 0 end,
      p_mode,
      coalesce((p_log->>'latency_ms')::int, 0),
      (p_log->>'ttft_ms')::int,
      coalesce((p_log->>'status')::int, 200),
      p_log->>'error_code'
    );
  end if;
end;
$$;

revoke all on function public.settle_usage(uuid,uuid,text,numeric,bigint,bigint,numeric,jsonb,date)
  from public, anon, authenticated;
