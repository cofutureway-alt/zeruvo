-- Smoke test for the free-credit-offer engine. Entirely rolled back.
begin;

do $$
declare
  v_user uuid;
  v_offer_id uuid;
  v_prov_id uuid;
  v_model_ok uuid;    -- offer-covered priced model
  v_model_other uuid; -- another priced model NOT in the offer
  v_key_id uuid;
  v_res jsonb;
  v_bal numeric;
  v_offer_bal numeric;
  v_log jsonb;
begin
  -- a user with fewer than 2 active keys (the trigger caps inserts)
  select p.id into v_user
  from public.profiles p
  left join public.user_api_keys k on k.user_id = p.id and k.status = 'active'
  group by p.id
  order by count(k.id) asc, p.created_at desc
  limit 1;
  if v_user is null then raise exception 'SMOKE: no users'; end if;

  -- throwaway provider + two priced models (rolled back with everything else)
  insert into public.providers (display_name, kind, base_url, status)
  values ('smoke-prov', 'custom', 'https://smoke.invalid', 'disabled')
  returning id into v_prov_id;

  insert into public.models (provider_id, slug, upstream_model_id, display_name, enabled_for_users, payg_enabled, input_price_per_m, output_price_per_m, usage_multiplier)
  values (v_prov_id, 'smoke-model-a', 'smoke-model-a', 'Smoke A', true, true, 1.000000, 2.000000, 1)
  returning id into v_model_ok;

  insert into public.models (provider_id, slug, upstream_model_id, display_name, enabled_for_users, payg_enabled, input_price_per_m, output_price_per_m, usage_multiplier)
  values (v_prov_id, 'smoke-model-b', 'smoke-model-b', 'Smoke B', true, true, 3.000000, 4.000000, 1)
  returning id into v_model_other;

  perform set_config('request.jwt.claim.sub', v_user::text, true);

  insert into public.credit_offers (name, amount_usd, model_ids, audience, new_user_days, expires_days, active)
  values ('smoke-offer', 1.00, array[v_model_ok], 'new_users', 36500, 10, true)
  returning id into v_offer_id;

  insert into public.user_api_keys (user_id, name, prefix, last4, sha256_hash, allowed_models, rate_limit_per_min, status)
  values (v_user, 'smoke', 'nx-smoke', '0000', md5(random()::text) || md5(random()::text), '{}', 60, 'active')
  returning id into v_key_id;

  delete from public.wallets where user_id = v_user;

  -- 1) claim succeeds and credits the offer balance
  v_res := public.claim_credit_offer(v_offer_id);
  if v_res->>'ok' is distinct from 'true' then
    raise exception 'SMOKE: claim failed: %', v_res::text;
  end if;
  select offer_balance_usd into v_offer_bal from public.wallets where user_id = v_user;
  if v_offer_bal is distinct from 1.00 then
    raise exception 'SMOKE: offer balance wrong: %', v_offer_bal;
  end if;

  -- 2) second claim is rejected
  v_res := public.claim_credit_offer(v_offer_id);
  if v_res->>'code' is distinct from 'ALREADY_CLAIMED' then
    raise exception 'SMOKE: double claim not rejected: %', v_res::text;
  end if;

  -- 3) reserve on the ALLOWED model → wallet mode
  v_res := public.reserve_request(v_user, v_key_id, v_model_ok, 1000, 1000);
  if v_res->>'mode' is distinct from 'wallet' then
    raise exception 'SMOKE: expected wallet mode, got %', v_res::text;
  end if;

  -- 4) settle $0.40 → offer credit debited first, real balance untouched
  v_log := jsonb_build_object('api_key_id', v_key_id, 'model_id', v_model_ok, 'upstream_model', 'm',
           'tokens_in', 500, 'tokens_out', 500, 'cache_read_tokens', 0, 'cache_write_tokens', 0,
           'latency_ms', 10, 'ttft_ms', 5, 'status', 200);
  perform public.settle_usage(v_user, v_key_id, 'wallet', (v_res->>'hold_usd')::numeric, 0, 0, 0.40, v_log);
  select remaining_usd into v_offer_bal from public.credit_offer_claims where user_id = v_user and offer_id = v_offer_id;
  if v_offer_bal is distinct from 0.60 then
    raise exception 'SMOKE: claim remaining after offer spend wrong: %', v_offer_bal;
  end if;

  -- 5) reserve on a NON-allowed model with zero real balance → OFFER_MODEL_RESTRICTED
  begin
    perform public.reserve_request(v_user, v_key_id, v_model_other, 1000, 1000);
    raise exception 'SMOKE: expected OFFER_MODEL_RESTRICTED, got success';
  exception when others then
    if sqlerrm not like '%OFFER_MODEL_RESTRICTED%' then
      raise exception 'SMOKE: wrong error for non-allowed model: %', sqlerrm;
    end if;
  end;

  -- 6) with real balance topped up, the non-allowed model spends REAL money only
  perform public.wallet_credit(v_user, 5.00, 'topup');
  v_res := public.reserve_request(v_user, v_key_id, v_model_other, 1000, 1000);
  if v_res->>'mode' is distinct from 'wallet' then
    raise exception 'SMOKE: expected wallet after topup: %', v_res::text;
  end if;
  v_log := jsonb_build_object('api_key_id', v_key_id, 'model_id', v_model_other, 'upstream_model', 'm',
           'tokens_in', 500, 'tokens_out', 500, 'cache_read_tokens', 0, 'cache_write_tokens', 0,
           'latency_ms', 10, 'ttft_ms', 5, 'status', 200);
  perform public.settle_usage(v_user, v_key_id, 'wallet', (v_res->>'hold_usd')::numeric, 0, 0, 0.10, v_log);
  select balance_usd into v_bal from public.wallets where user_id = v_user;
  if v_bal is distinct from 4.90 then
    raise exception 'SMOKE: real balance after non-allowed spend wrong: %', v_bal;
  end if;
  select remaining_usd into v_offer_bal from public.credit_offer_claims where user_id = v_user and offer_id = v_offer_id;
  if v_offer_bal is distinct from 0.60 then
    raise exception 'SMOKE: offer credit must be untouched by non-allowed spend: %', v_offer_bal;
  end if;

  -- 7) expiry zeroes the claim and the wallet offer balance
  update public.credit_offer_claims
  set expires_at = now() - interval '1 minute'
  where user_id = v_user and offer_id = v_offer_id;
  perform public.expire_credit_offers();
  select remaining_usd, offer_balance_usd into v_offer_bal, v_bal
  from public.credit_offer_claims c
  left join public.wallets w on w.user_id = c.user_id
  where c.user_id = v_user and c.offer_id = v_offer_id;
  if v_offer_bal is distinct from 0 or v_bal is distinct from 0 then
    raise exception 'SMOKE: expiry did not clear credit: claim=% wallet=%', v_offer_bal, v_bal;
  end if;

  -- 8) 100% discount with NULL valid_to is ACTIVE
  insert into public.model_discounts (model_id, applies_to, kind, value, valid_from, valid_to, active)
  values (v_model_ok, 'all', 'percent', 100, now() - interval '1 hour', null, true);
  if (select input_price from public.effective_model_prices(v_model_ok)) is distinct from 0 then
    raise exception 'SMOKE: 100%% no-expiry discount not applied';
  end if;

  raise notice 'SMOKE_OK';
end $$;

rollback;

select 'SMOKE_COMPLETE' as result;
