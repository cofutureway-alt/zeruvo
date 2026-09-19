-- ============================================================
-- Audit fixes (round: comprehensive audit)
--   1. app_settings turnstile columns existed in code but in NO
--      migration — fresh environments broke admin settings and
--      silently disabled every captcha gate.
--   2. claim_credit_offer: check-then-insert race — two concurrent
--      claims both ran the unconditional wallet credit. Now the
--      INSERT ... ON CONFLICT ... RETURNING is the authority and
--      only the winner credits the wallet.
--   3. expire_credit_offers locked claims→wallets while settle_usage
--      locks wallets→claims (AB-BA deadlock). Lock order is now
--      wallets-first everywhere.
--   4. Deleting a credit offer cascaded its claims but left the
--      phantom wallets.offer_balance_usd spendable — a BEFORE DELETE
--      trigger now strips unspent offer credit (with a ledger row).
-- ============================================================

-- 1) turnstile columns -------------------------------------------------
alter table public.app_settings
  add column if not exists turnstile_enabled boolean not null default false,
  add column if not exists turnstile_site_key text not null default '',
  add column if not exists turnstile_on_login boolean not null default true,
  add column if not exists turnstile_on_api_key boolean not null default false;

-- 2) claim race fix ----------------------------------------------------
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
  v_claim_id uuid;
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

  -- the unique(offer_id, user_id) conflict is the authority: only the
  -- request that actually inserts a claim row may credit the wallet
  insert into public.credit_offer_claims (offer_id, user_id, remaining_usd, expires_at)
  values (p_offer_id, v_user, v_offer.amount_usd,
          case when v_offer.expires_days is not null
               then now() + make_interval(days => v_offer.expires_days)
               else 'infinity'::timestamptz end)
  on conflict (offer_id, user_id) do nothing
  returning id into v_claim_id;

  if v_claim_id is null then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_CLAIMED');
  end if;

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

-- 3) expire: wallets-first lock order (matches settle_usage) -----------
create or replace function public.expire_credit_offers()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_zeroed numeric(12,6);
begin
  for r in
    select c.id, c.user_id, c.remaining_usd
    from public.credit_offer_claims c
    where c.remaining_usd > 0 and c.expires_at <= now()
  loop
    -- same lock order as settle_usage (wallets → claims): no AB-BA deadlock
    perform 1 from public.wallets w where w.user_id = r.user_id for update;

    update public.credit_offer_claims
    set remaining_usd = 0
    where id = r.id
      and remaining_usd > 0
      and expires_at <= now()
    returning r.remaining_usd into v_zeroed;

    if found then
      update public.wallets
      set offer_balance_usd = greatest(offer_balance_usd - v_zeroed, 0),
          updated_at = now()
      where user_id = r.user_id;

      insert into public.wallet_transactions (user_id, kind, amount_usd, balance_after, note)
      select r.user_id, 'offer_expire', 0, w.balance_usd,
             'Free credit expired: -' || v_zeroed::text
      from public.wallets w where w.user_id = r.user_id;
    end if;
  end loop;
end;
$$;

revoke all on function public.expire_credit_offers() from public, anon, authenticated;
grant execute on function public.expire_credit_offers() to service_role;

-- 4) offer delete: strip the unspent offer balance it backs ------------
create or replace function public.strip_offer_balance_on_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select user_id, remaining_usd
    from public.credit_offer_claims
    where offer_id = old.id and remaining_usd > 0
  loop
    update public.wallets
    set offer_balance_usd = greatest(offer_balance_usd - r.remaining_usd, 0),
        updated_at = now()
    where user_id = r.user_id;

    insert into public.wallet_transactions (user_id, kind, amount_usd, balance_after, note)
    select r.user_id, 'offer_expire', 0, w.balance_usd,
           'Offer removed by admin: -' || r.remaining_usd::text
    from public.wallets w where w.user_id = r.user_id;
  end loop;
  return old;
end;
$$;

drop trigger if exists credit_offers_strip_balance on public.credit_offers;
create trigger credit_offers_strip_balance
before delete on public.credit_offers
for each row execute function public.strip_offer_balance_on_delete();

notify pgrst, 'reload schema';
