-- ============================================================
-- SECURITY FIX (HIGH — H5): coupon-per-user was not enforced
-- atomically. checkout/index.ts:109 checks `times_redeemed <
-- max_redemptions` (the GLOBAL total) but never checks whether THIS
-- user already redeemed it, so one user could consume an entire
-- limited coupon's budget. Worse, kashier-webhook did:
--     insert_redemptions(...).then(() => increment_coupon_redeemed(...))
-- so a replayed webhook (or a race) would: (a) fail the UNIQUE insert
-- silently, (b) STILL increment times_redeemed — burning the budget
-- without creating a redemption row, then re-chargها على المستخدمين الآخرين.
--
-- Fix: one atomic, idempotent RPC that:
--   • returns false if the user already redeemed this coupon
--   • inserts the redemption row (payment_id tied to this user)
--   • increments times_redeemed ONLY on successful insert
--   • is guarded by the UNIQUE (coupon_code, user_id) constraint
-- All caller logic collapses to calling this single function.
-- ============================================================

create or replace function public.redeem_coupon(p_code text, p_user_id uuid, p_payment_id uuid)
returns boolean  -- true = newly redeemed, false = already used / exhausted / not found
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan  text;
  v_max   int;
  v_used  int;
  v_exists boolean;
begin
  -- 1) coupon must exist, be active, and not exhausted
  select max_redemptions, times_redeemed into v_max, v_used
  from public.coupons
  where code = p_code and active = true;

  if v_max is null then        -- not found or inactive
    return false;
  end if;
  if v_used >= v_max then      -- global budget exhausted
    return false;
  end if;

  -- 2) per-user: already redeemed? (idempotent against replays)
  select exists (
    select 1 from public.coupon_redemptions
    where coupon_code = p_code and user_id = p_user_id
  ) into v_exists;
  if v_exists then
    return false;  -- user already used this coupon; do NOT increment counter
  end if;

  -- 3) atomic insert + increment. The UNIQUE (coupon_code, user_id)
  --    constraint is our backstop against concurrent callers: if two
  --    requests race, only one INSERT succeeds, the other raises
  --    unique_violation which we catch and treat as "already used".
  begin
    insert into public.coupon_redemptions (coupon_code, user_id, payment_id)
    values (p_code, p_user_id, p_payment_id);

    update public.coupons
    set times_redeemed = times_redeemed + 1
    where code = p_code;

    return true;
  exception
    when unique_violation then
      return false;  -- concurrent redemption won the race — not an error
  end;
end;
$$;

revoke all on function public.redeem_coupon(text, uuid, uuid) from public, anon, authenticated;

-- keep the old helper for any external callers — it now delegates to the
-- atomic path so its behavior is correct even if invoked standalone
create or replace function public.increment_coupon_redeemed(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- only increment if under the cap; the real per-user enforcement lives
  -- in redeem_coupon above (called from the webhook)
  update public.coupons
  set times_redeemed = least(times_redeemed + 1, max_redemptions)
  where code = p_code and times_redeemed < max_redemptions;
end;
$$;
