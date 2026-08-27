-- Zeruvo AI seed: default free plan + smoke-test data
insert into public.plans (name, description, daily_weighted_tokens, price_usd, duration_unit, duration_count, is_free, default_free)
values (
  '{"en":"Free","ar":"مجانية","fr":"Gratuit","zh":"免费"}'::jsonb,
  '{"en":"Starter plan","ar":"خطة البداية"}'::jsonb,
  1000000, 0, 'days', 30, true, true)
returning id;
