-- ============================================================
-- ALIAS-AWARE BILLING ENGINE: a custom model (fake public name for a
-- real base model) was rejected everywhere because plan-membership and
-- offer-allowlist checks ran against the ALIAS row — which no plan or
-- offer lists. Both reserve_request and settle_usage now resolve the
-- alias to its parent first:
--   • plan gate: plan must include the parent (or the alias itself)
--   • model rate limits: the parent's row governs upstream traffic
--   • free-credit offer allowlist: parent or alias matches
-- The alias's own usage_multiplier and PAYG prices still decide the
-- charge (admins price aliases independently on purpose).
-- ============================================================

create or replace function public.reserve_request(
  p_user_id uuid, p_api_key_id uuid, p_model_id uuid,
  p_est_tokens_in bigint, p_est_tokens_out bigint,
  p_today date default (now() at time zone 'utc')::date
) returns jsonb
language plpgsql security definer
set search_path = 'public'
as $fn$
declare
  v_model record;
  v_gate uuid;            -- id used for plan/rate-limit/offer checks
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
         m.parent_model_id, m.is_custom,
         ep.input_price, ep.output_price
  into v_model
  from public.models m
  cross join lateral public.effective_model_prices(m.id) ep
  where m.id = p_model_id;
  if not found then
    raise exception 'MODEL_NOT_FOUND';
  end if;

  -- aliases are entitled by their parent model (or by the alias row itself)
  v_gate := case when v_model.is_custom
                 then coalesce(v_model.parent_model_id, p_model_id)
                 else p_model_id end;

  -- ---- rate limits (model row overrides global defaults; NULL = off) ----
  -- the parent governs upstream traffic; an explicit row on the alias wins
  select coalesce(rl_own.rpm, rl_par.rpm, d.rpm)  as rpm,
         coalesce(rl_own.rph, rl_par.rph, d.rph)  as rph,
         coalesce(rl_own.rpd, rl_par.rpd, d.rpd)  as rpd,
         coalesce(rl_own.tpm, rl_par.tpm, d.tpm)  as tpm
  into v_lim
  from public.rate_limit_defaults d
  left join public.model_rate_limits rl_own on rl_own.model_id = p_model_id
  left join public.model_rate_limits rl_par on rl_par.model_id = v_gate
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
       and not (v_gate = any (v_plan_models))
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
  -- an offer may list the alias or its parent — either counts
  select coalesce(bool_or(true), false) into v_offer_ok
  from public.credit_offer_claims c
  join public.credit_offers o on o.id = c.offer_id
  where c.user_id = p_user_id
    and c.remaining_usd > 0
    and c.expires_at > now()
    and o.active
    and (p_model_id = any (o.model_ids) or v_gate = any (o.model_ids));

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
$fn$;

revoke all on function public.reserve_request(uuid, uuid, uuid, bigint, bigint, date) from public, anon, authenticated;
grant execute on function public.reserve_request(uuid, uuid, uuid, bigint, bigint, date) to service_role;


create or replace function public.settle_usage(
  p_user_id uuid, p_api_key_id uuid default null, p_mode text default 'plan',
  p_hold_usd numeric default 0, p_reserved_weighted bigint default 0,
  p_actual_weighted bigint default 0, p_actual_cost_usd numeric default 0,
  p_log jsonb default null,
  p_today date default (now() at time zone 'utc')::date
) returns void
language plpgsql security definer
set search_path = 'public'
as $fn$
declare
  v_balance numeric(12,6);
  v_reserved numeric(12,6);
  v_offer_bal numeric(12,6);
  v_hold numeric(12,6);
  v_cost numeric(12,6);
  v_new_balance numeric(12,6);
  v_debt numeric(12,6) := 0;
  v_key_id uuid := coalesce(p_api_key_id, nullif(p_log->>'api_key_id', '')::uuid);
  v_log_model uuid := nullif(p_log->>'model_id', '')::uuid;
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
      -- free credit first, but only when the model (or the alias's parent)
      -- is allowlisted by a live claim
      if v_cost > 0 and coalesce(v_offer_bal, 0) > 0 and v_log_model is not null then
        for v_claim in
          select c.id, c.remaining_usd
          from public.credit_offer_claims c
          join public.credit_offers o on o.id = c.offer_id
          join public.models mm on mm.id = v_log_model
          where c.user_id = p_user_id
            and c.remaining_usd > 0
            and c.expires_at > now()
            and o.active
            and (v_log_model = any (o.model_ids)
                 or mm.parent_model_id = any (o.model_ids))
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
$fn$;

revoke all on function public.settle_usage(uuid, uuid, text, numeric, bigint, bigint, numeric, jsonb, date) from public, anon, authenticated;
grant execute on function public.settle_usage(uuid, uuid, text, numeric, bigint, bigint, numeric, jsonb, date) to service_role;

notify pgrst, 'reload schema';
