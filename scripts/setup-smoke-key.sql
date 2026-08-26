delete from daily_usage where user_id = '2ab124e4-2d64-44e0-bc13-2c1ba62150fd';

insert into user_api_keys (user_id, name, prefix, last4, sha256_hash)
values (
  '2ab124e4-2d64-44e0-bc13-2c1ba62150fd',
  'smoke',
  'sk-nexor-smoke',
  'a9ff',
  '6dddec8a806a162fce05b8e2338d491163963a5c9b08255d6fc7c0ce062f4541'
)
on conflict (sha256_hash) do update set status = 'active'
returning id;
