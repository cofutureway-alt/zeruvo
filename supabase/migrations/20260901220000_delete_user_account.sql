-- ============================================================
-- Account self-deletion feature (Privacy policy compliance).
-- Single atomic stored procedure so that a failure mid-way doesn't
-- leave the user's data in a half-deleted state.
-- Runs as table owner via SECURITY DEFINER so it works regardless
-- of the caller's RLS role. The edge function passes the user's
-- own id, validated server-side — the function never trusts the
-- caller to delete a different user's account.
-- ============================================================

create or replace function public.delete_user_account(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  -- guard: can't delete the last admin via this path
  perform 1 from public.profiles
  where id = p_user_id and role = 'admin'
  and not exists (
    select 1 from public.profiles
    where role = 'admin' and id <> p_user_id
  );
  if found then
    raise exception 'cannot delete the last admin via self-service';
  end if;

  -- 1. cancel pending payments
  delete from public.payments
  where user_id = p_user_id and status = 'pending';

  -- 2. mark all payment intents as failed (they're no longer usable)
  update public.payments
  set status = 'failed', meta = jsonb_set(meta, '{deleted_user}', 'true')
  where user_id = p_user_id and status = 'pending';

  -- 3. cancel subscriptions
  update public.subscriptions
  set status = 'canceled'
  where user_id = p_user_id and status = 'active';

  -- 4. revoke API keys (permanent — they're hashed, nothing to "soft delete")
  delete from public.user_api_keys where user_id = p_user_id;

  -- 5. coupon redemptions
  delete from public.coupon_redemptions where user_id = p_user_id;

  -- 6. usage
  delete from public.daily_usage where user_id = p_user_id;
  delete from public.request_logs where user_id = p_user_id;

  -- 7. profile (this cascades via FK for some tables)
  delete from public.profiles where id = p_user_id;

  -- 8. auth user
  delete from auth.users where id = p_user_id;

  return;
end;
$$;

revoke all on function public.delete_user_account(uuid) from public, anon, authenticated;
