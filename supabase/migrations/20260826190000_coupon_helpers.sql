-- Coupon redemption helper: atomic increment, capped at max_redemptions
create or replace function public.increment_coupon_redeemed(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max int;
  v_used int;
begin
  select max_redemptions, times_redeemed into v_max, v_used
  from public.coupons where code = p_code;

  if v_max is null then return; end if;
  if v_used >= v_max then return; end if;

  update public.coupons
  set times_redeemed = times_redeemed + 1
  where code = p_code;
end;
$$;

revoke all on function public.increment_coupon_redeemed(text) from public, anon, authenticated;
