-- Smoke test for delete_api_key (the RPC behind the Keys page delete).
-- Insert a throwaway revoked key for an admin, delete it via the RPC,
-- verify the row is gone. Entirely rolled back.
begin;

do $$
declare
  v_admin uuid;
  v_key_id uuid;
  v_deleted boolean;
  v_gone int;
begin
  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;
  if v_admin is null then raise exception 'SMOKE: no admin user'; end if;

  insert into public.user_api_keys (user_id, name, prefix, last4, sha256_hash, allowed_models, rate_limit_per_min, status)
  values (v_admin, 'smoke-delete', 'nx-smoke', '0001', md5(random()::text) || md5(random()::text), '{}', 60, 'revoked')
  returning id into v_key_id;

  v_deleted := public.delete_api_key(v_key_id, v_admin);
  if not v_deleted then raise exception 'SMOKE: delete_api_key returned false'; end if;

  select count(*) into v_gone from public.user_api_keys where id = v_key_id;
  if v_gone <> 0 then raise exception 'SMOKE: key row still present'; end if;

  raise notice 'DELETE_SMOKE_OK';
end $$;

rollback;

select 'DELETE_SMOKE_COMPLETE' as result;
