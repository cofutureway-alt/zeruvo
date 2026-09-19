-- ============================================================
-- FREE CREDIT OFFERS
-- Admin grants wallet credit restricted to a chosen model list,
-- targeted at: new accounts / plan subscribers / users who topped up.
-- Optional anti-abuse gate: lifetime topups >= require_topup_usd.
-- Credit expires N days after claim (per-offer expires_days).
--
-- Spending model (approved):
--   - offer credit is a SEPARATE balance (wallets.offer_balance_usd)
--   - it only pays for models allowlisted by a live (unspent, unexpired) claim
--   - the user's own balance keeps working on every model
--   - OFFER_MODEL_RESTRICTED is raised only when the request cannot be
--     covered by real funds but the offer balance could have covered it
--
-- ALSO IN THIS FILE:
--   - model_discounts.valid_to becomes nullable (empty = never expires)
--     — fixes 100%-discount silently not saving (AdminModels gated the
--     insert on valid_to being non-empty, then deleted the old discount)
--   - delete_api_key re-applied (create-or-replace + grants) as insurance
-- ============================================================

-- ---------- wallets: separate offer balance ----------
alter table public.wallets
  add column if not exists offer_balance_usd numeric(12,6) not null default 0;

-- ---------- offers ----------
create table if not exists public.credit_offers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  amount_usd numeric(12,2) not null check (amount_usd > 0),
  model_ids uuid[] not null default '{}',
  audience text not null check (audience in ('new_users','plan_subscribers','topped_up')),
  audience_plan_id uuid references public.plans(id) on delete set null,
  new_user_days int not null default 30 check (new_user_days > 0),
  require_topup_usd numeric(12,2),
  expires_days int check (expires_days is null or expires_days > 0),
  max_claims int check (max_claims is null or max_claims > 0),
  active boolean not null default true,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  created_at timestamptz not null default now()
);

alter table public.credit_offers enable row level security;
drop policy if exists "credit_offers: admin all" on public.credit_offers;
create policy "credit_offers: admin all" on public.credit_offers
  for all using (public.is_admin()) with check (public.is_admin());

-- server-side validation (CHECK constraints can't subquery app_settings)
create or replace function public.validate_credit_offer_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_min numeric(12,2);
begin
  select wallet_min_topup_usd into v_min from public.app_settings where id = 1;
  if new.require_topup_usd is not null and new.require_topup_usd < coalesce(v_min, 0) then
    raise exception 'REQUIRE_TOPUP_BELOW_MIN:%', coalesce(v_min, 0)
      using errcode = 'check_violation';
  end if;
  if new.audience = 'plan_subscribers' and new.audience_plan_id is null then
    raise exception 'AUDIENCE_PLAN_REQUIRED' using errcode = 'check_violation';
  end if;
  if new.model_ids is null or array_length(new.model_ids, 1) is null then
    raise exception 'OFFER_MODELS_REQUIRED' using errcode = 'check_violation';
  end if;
  if new.valid_to is not null and new.valid_to <= new.valid_from then
    raise exception 'OFFER_WINDOW_INVALID' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists credit_offers_validate on public.credit_offers;
create trigger credit_offers_validate
before insert or update on public.credit_offers
for each row execute function public.validate_credit_offer_row();

-- ---------- claims ----------
create table if not exists public.credit_offer_claims (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.credit_offers(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  remaining_usd numeric(12,6) not null check (remaining_usd >= 0),
  claimed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (offer_id, user_id)
);
create index if not exists credit_offer_claims_user_idx
  on public.credit_offer_claims (user_id) where remaining_usd > 0;

alter table public.credit_offer_claims enable row level security;
drop policy if exists "credit_offer_claims: owner read" on public.credit_offer_claims;
create policy "credit_offer_claims: owner read" on public.credit_offer_claims
  for select using (user_id = auth.uid() or public.is_admin());

-- ---------- wallet ledger: offer kinds ----------
alter table public.wallet_transactions drop constraint if exists wallet_transactions_kind_check;
alter table public.wallet_transactions add constraint wallet_transactions_kind_check
  check (kind in ('topup','usage','refund','admin_grant','admin_deduct','offer_grant','offer_expire'));

-- ---------- claim an offer (user) ----------
create or replace function public.claim_credit_offer(p_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_offer public.credit_offers%rowtype;
  v_topup_sum numeric(12,2);
  v_created_at timestamptz;
  v_claims int;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;

  select * into v_offer from public.credit_offers where id = p_offer_id;
  if not found or not v_offer.active
     or now() < v_offer.valid_from
     or (v_offer.valid_to is not null and now() > v_offer.valid_to) then
    return jsonb_build_object('ok', false, 'code', 'OFFER_UNAVAILABLE');
  end if;

  if exists (select 1 from public.credit_offer_claims
             where offer_id = p_offer_id and user_id = v_user) then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_CLAIMED');
  end if;

  if v_offer.max_claims is not null then
    select count(*) into v_claims from public.credit_offer_claims where offer_id = p_offer_id;
    if v_claims >= v_offer.max_claims then
      return jsonb_build_object('ok', false, 'code', 'OFFER_EXHAUSTED');
    end if;
  end if;

  select created_at into v_created_at from public.profiles where id = v_user;

  if v_offer.audience = 'new_users' then
    if v_created_at is null or v_created_at < now() - make_interval(days => v_offer.new_user_days) then
      return jsonb_build_object('ok', false, 'code', 'NOT_ELIGIBLE');
    end if;
  elsif v_offer.audience = 'plan_subscribers' then
    if not exists (
      select 1 from public.subscriptions s
      where s.user_id = v_user and s.status = 'active' and s.expires_at > now()
        and s.plan_id = v_offer.audience_plan_id
    ) then
      return jsonb_build_object('ok', false, 'code', 'NOT_ELIGIBLE');
    end if;
  elsif v_offer.audience = 'topped_up' then
    if not exists (
      select 1 from public.wallet_transactions
      where user_id = v_user and kind = 'topup' and amount_usd > 0
    ) then
      return jsonb_build_object('ok', false, 'code', 'NOT_ELIGIBLE');
    end if;
  end if;

  -- anti-abuse condition: lifetime topups must reach the threshold
  if v_offer.require_topup_usd is not null then
    select coalesce(sum(amount_usd), 0) into v_topup_sum
    from public.wallet_transactions
    where user_id = v_user and kind = 'topup' and amount_usd > 0;
    if v_topup_sum < v_offer.require_topup_usd then
      return jsonb_build_object('ok', false, 'code', 'NEEDS_TOPUP',
                                'required_topup_usd', v_offer.require_topup_usd,
                                'topped_up_usd', v_topup_sum);
    end if;
  end if;

  insert into public.credit_offer_claims (offer_id, user_id, remaining_usd, expires_at)
  values (p_offer_id, v_user, v_offer.amount_usd,
          case when v_offer.expires_days is not null
               then now() + make_interval(days => v_offer.expires_days)
               else 'infinity'::timestamptz end)
  on conflict (offer_id, user_id) do nothing;

  insert into public.wallets (user_id, offer_balance_usd)
  values (v_user, v_offer.amount_usd)
  on conflict (user_id) do update
    set offer_balance_usd = wallets.offer_balance_usd + excluded.offer_balance_usd,
        updated_at = now();

  insert into public.wallet_transactions (user_id, kind, amount_usd, balance_after, note)
  select v_user, 'offer_grant', v_offer.amount_usd, w.balance_usd,
         'Free credit offer: ' || v_offer.name
  from public.wallets w where w.user_id = v_user;

  return jsonb_build_object('ok', true, 'granted_usd', v_offer.amount_usd);
end;
$$;

revoke all on function public.claim_credit_offer(uuid) from public, anon, authenticated;
grant execute on function public.claim_credit_offer(uuid) to authenticated, service_role;

-- ---------- offers visible to the current user ----------
create or replace function public.list_credit_offers()
returns table (
  id uuid,
  name text,
  amount_usd numeric,
  models jsonb,
  audience text,
  require_topup_usd numeric,
  expires_days int,
  already_claimed boolean,
  remaining_usd numeric,
  claim_expires_at timestamptz,
  eligible boolean,
  needs_topup boolean,
  topped_up_usd numeric
)
language sql
security definer
set search_path = public
stable
as $$
  with me as (select auth.uid() as uid),
  u as (
    select me.uid, pr.created_at
    from me join public.profiles pr on pr.id = me.uid
  ),
  my_topup as (
    select coalesce(sum(t.amount_usd), 0) as s
    from public.wallet_transactions t, me
    where t.user_id = me.uid and t.kind = 'topup' and t.amount_usd > 0
  ),
  my_plan as (
    select exists (
      select 1 from public.subscriptions s, me
      where s.user_id = me.uid and s.status = 'active' and s.expires_at > now()
    ) as has_active
  ),
  claims as (
    select c.offer_id, c.remaining_usd, c.expires_at
    from public.credit_offer_claims c, me
    where c.user_id = me.uid
  )
  select
    o.id,
    o.name,
    o.amount_usd,
    coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.display_name) order by m.display_name)
      from public.models m where m.id = any (o.model_ids)
    ), '[]'::jsonb),
    o.audience,
    o.require_topup_usd,
    o.expires_days,
    c.offer_id is not null,
    c.remaining_usd,
    c.expires_at,
    case
      when c.offer_id is not null then false
      when o.audience = 'new_users' then
        u.created_at is not null
        and u.created_at >= now() - make_interval(days => o.new_user_days)
      when o.audience = 'plan_subscribers' then
        mp.has_active
        and exists (
          select 1 from public.subscriptions s, me
          where s.user_id = me.uid and s.status = 'active' and s.expires_at > now()
            and s.plan_id = o.audience_plan_id
        )
      when o.audience = 'topped_up' then mt.s > 0
      else false
    end,
    c.offer_id is null
      and o.require_topup_usd is not null
      and mt.s < o.require_topup_usd,
    mt.s
  from public.credit_offers o
  left join claims c on c.offer_id = o.id
  cross join u
  cross join my_topup mt
  cross join my_plan mp
  where o.active
    and now() >= o.valid_from
    and (o.valid_to is null or now() <= o.valid_to)
    and (o.max_claims is null
         or (select count(*) from public.credit_offer_claims c2
             where c2.offer_id = o.id) < o.max_claims)
  order by o.created_at desc;
$$;

revoke all on function public.list_credit_offers() from public, anon, authenticated;
grant execute on function public.list_credit_offers() to authenticated, service_role;

-- ---------- expire unspent offer credit (cron) ----------
create or replace function public.expire_credit_offers()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select c.id, c.user_id, c.remaining_usd
    from public.credit_offer_claims c
    where c.remaining_usd > 0 and c.expires_at <= now()
    for update
  loop
    update public.credit_offer_claims set remaining_usd = 0 where id = r.id;

    update public.wallets
    set offer_balance_usd = greatest(offer_balance_usd - r.remaining_usd, 0),
        updated_at = now()
    where user_id = r.user_id;

    insert into public.wallet_transactions (user_id, kind, amount_usd, balance_after, note)
    select r.user_id, 'offer_expire', 0, w.balance_usd,
           'Free credit expired: -' || r.remaining_usd::text
    from public.wallets w where w.user_id = r.user_id;
  end loop;
end;
$$;

revoke all on function public.expire_credit_offers() from public, anon, authenticated;
grant execute on function public.expire_credit_offers() to service_role;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'expire_credit_offers_daily') then
    perform cron.schedule('expire_credit_offers_daily', '25 1 * * *',
                          'select public.expire_credit_offers()');
  end if;
end $$;

-- ============================================================
-- reserve_request: offer-aware wallet path
-- (plan path untouched; offer credit only enters the wallet path)
-- ============================================================
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
  v_offer_bal numeric(12,6);
  v_offer_ok boolean;
  v_spendable numeric(12,6);
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

  -- ---- wallet path: USD hold against balance + offer credit ----
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

  -- is this model covered by a live (unspent, unexpired) offer claim?
  select coalesce(bool_or(true), false) into v_offer_ok
  from public.credit_offer_claims c
  join public.credit_offers o on o.id = c.offer_id
  where c.user_id = p_user_id
    and c.remaining_usd > 0
    and c.expires_at > now()
    and o.active
    and p_model_id = any (o.model_ids);

  select w.balance_usd, w.reserved_usd, w.offer_balance_usd
  into v_balance, v_hold_resv, v_offer_bal
  from public.wallets w
  where w.user_id = p_user_id
  for update;

  v_spendable := coalesce(v_balance, 0) - coalesce(v_hold_resv, 0)
               + (case when v_offer_ok then coalesce(v_offer_bal, 0) else 0 end);

  if v_spendable < v_est_cost then
    -- real funds cannot cover it, but unspent offer credit could —
    -- point the user at the restriction instead of a generic 402
    if not v_offer_ok
       and coalesce(v_offer_bal, 0) > 0
       and coalesce(v_balance, 0) - coalesce(v_hold_resv, 0) + coalesce(v_offer_bal, 0) >= v_est_cost then
      raise exception 'OFFER_MODEL_RESTRICTED';
    end if;
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

-- ============================================================
-- settle_usage: debit offer credit first (FIFO), then real balance
-- ============================================================
create or replace function public.settle_usage(
  p_user_id uuid,
  p_api_key_id uuid default null,
  p_mode text = 'plan',
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
  v_offer_bal numeric(12,6);
  v_hold numeric(12,6);
  v_cost numeric(12,6);
  v_new_balance numeric(12,6);
  v_debt numeric(12,6) := 0;
  v_key_id uuid := coalesce(p_api_key_id, nullif(p_log->>'api_key_id', '')::uuid);
  v_offer_used numeric(12,6) := 0;
  v_take numeric(12,6);
  v_claim record;
  v_real numeric(12,6);
begin
  v_cost := greatest(coalesce(p_actual_cost_usd, 0), 0);

  if p_mode = 'wallet' then
    v_hold := greatest(coalesce(p_hold_usd, 0), 0);

    select w.balance_usd, w.reserved_usd, w.offer_balance_usd
    into v_balance, v_reserved, v_offer_bal
    from public.wallets w where w.user_id = p_user_id for update;

    if v_balance is not null then
      -- free credit first, but only when the model is allowlisted by a live claim
      if v_cost > 0 and coalesce(v_offer_bal, 0) > 0 and p_log->>'model_id' is not null then
        for v_claim in
          select c.id, c.remaining_usd
          from public.credit_offer_claims c
          join public.credit_offers o on o.id = c.offer_id
          where c.user_id = p_user_id
            and c.remaining_usd > 0
            and c.expires_at > now()
            and o.active
            and (p_log->>'model_id')::uuid = any (o.model_ids)
          order by c.claimed_at
          for update of c
        loop
          v_take := least(v_claim.remaining_usd, v_cost - v_offer_used);
          update public.credit_offer_claims
          set remaining_usd = remaining_usd - v_take
          where id = v_claim.id;
          v_offer_used := v_offer_used + v_take;
          exit when v_offer_used >= v_cost;
        end loop;
      end if;
      v_offer_used := least(v_offer_used, v_cost);

      v_real := round(v_cost - v_offer_used, 6);
      v_new_balance := round(v_balance - v_real, 6);
      if v_new_balance < 0 then
        -- actual spend exceeded the estimate hold (client sent no max_tokens):
        -- bill what exists, forgive the remainder — never go negative
        v_debt := -v_new_balance;
        v_new_balance := 0;
      end if;

      update public.wallets
      set balance_usd = v_new_balance,
          offer_balance_usd = greatest(coalesce(offer_balance_usd, 0) - v_offer_used, 0),
          reserved_usd = greatest(reserved_usd - v_hold, 0),
          updated_at = now()
      where user_id = p_user_id;

      insert into public.wallet_transactions (user_id, kind, amount_usd, balance_after, note)
      values (p_user_id, 'usage', -v_real, v_new_balance,
              case
                when v_debt > 0 then 'debt_forgiven:' || v_debt::text
                when v_offer_used > 0 then 'free_credit_used:' || v_offer_used::text
              end);

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

-- ============================================================
-- auth_key_lookup: offer credit counts toward the gateway's
-- "has credit" gate so offer-only users can reach reserve_request
-- ============================================================
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
         coalesce(w.balance_usd, 0) + coalesce(w.offer_balance_usd, 0),
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
           k.allowed_models, k.rate_limit_per_min, w.balance_usd, w.offer_balance_usd,
           pr.billing_preference, k.spend_limit_usd, k.total_spent_usd, pr.github_created_at;
$$;

revoke all on function public.auth_key_lookup(text) from public, anon, authenticated;

-- ============================================================
-- DISCOUNT FIX: valid_to nullable ("empty = never expires")
-- ============================================================
alter table public.model_discounts alter column valid_to drop not null;

drop policy if exists "model_discounts: read active" on public.model_discounts;
create policy "model_discounts: read active" on public.model_discounts
  for select using (active = true
                    and now() >= valid_from
                    and (valid_to is null or now() <= valid_to));

-- (check (valid_to > valid_from) may stay: NULL comparisons pass CHECKs)
create or replace function public.effective_model_prices(
  p_model_id uuid,
  p_at timestamptz default now()
)
returns table (
  input_price numeric,
  output_price numeric,
  cache_read_price numeric,
  cache_write_price numeric,
  discount_percent numeric
)
language sql
stable
set search_path = public
as $$
  with base as (
    select m.input_price_per_m  AS base_in,
           m.output_price_per_m AS base_out,
           m.cache_read_price_per_m AS base_cr,
           m.cache_write_price_per_m AS base_cw
    from public.models m where m.id = p_model_id
  ),
  disc as (
    select
      max(case when d.applies_to in ('input','all') then
        case when d.kind = 'percent' then d.value
             else case when b.base_in > 0 then least(d.value / b.base_in * 100, 100) else 100 end end
      end) as in_pct,
      max(case when d.applies_to in ('output','all') then
        case when d.kind = 'percent' then d.value
             else case when b.base_out > 0 then least(d.value / b.base_out * 100, 100) else 100 end end
      end) as out_pct,
      max(case when d.applies_to in ('cache_read','all') then
        case when d.kind = 'percent' then d.value
             else case when b.base_cr > 0 then least(d.value / b.base_cr * 100, 100) else 100 end end
      end) as cr_pct,
      max(case when d.applies_to in ('cache_write','all') then
        case when d.kind = 'percent' then d.value
             else case when b.base_cw > 0 then least(d.value / b.base_cw * 100, 100) else 100 end end
      end) as cw_pct
    from public.model_discounts d
    cross join base b
    where d.model_id = p_model_id
      and d.active
      and p_at >= d.valid_from
      and (d.valid_to is null or p_at <= d.valid_to)
  )
  select
    greatest(round(b.base_in  * (1 - coalesce(d.in_pct, 0) / 100.0), 6), 0),
    greatest(round(b.base_out * (1 - coalesce(d.out_pct, 0) / 100.0), 6), 0),
    greatest(round(b.base_cr  * (1 - coalesce(d.cr_pct, 0) / 100.0), 6), 0),
    greatest(round(b.base_cw  * (1 - coalesce(d.cw_pct, 0) / 100.0), 6), 0),
    greatest(coalesce(d.in_pct,0), coalesce(d.out_pct,0), coalesce(d.cr_pct,0), coalesce(d.cw_pct,0))
  from base b cross join disc d
$$;

revoke all on function public.effective_model_prices(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.effective_model_prices(uuid, timestamptz) to anon, authenticated, service_role;

-- ============================================================
-- INSURANCE for the api-key deletion bug: re-apply the RPC
-- (source chain client→edge→RPC is correct; guarantee the DB side)
-- ============================================================
create or replace function public.delete_api_key(p_key_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int;
begin
  delete from public.user_api_keys
  where id = p_key_id
    and user_id = p_user_id;

  get diagnostics v_deleted = row_count;

  if v_deleted > 0 then
    insert into public.audit_logs (admin_id, action, target_table, target_id, diff)
    values (p_user_id, 'delete_api_key', 'user_api_keys', p_key_id::text,
            '{"status": "permanently_deleted"}'::jsonb);
  end if;

  return v_deleted > 0;
end;
$$;

revoke all on function public.delete_api_key(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_api_key(uuid, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
