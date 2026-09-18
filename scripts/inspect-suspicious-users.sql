-- ============================================================
-- Investigation query: Find potentially suspicious accounts
-- Run this to identify users who may be fake/bot accounts
-- ============================================================

-- 1. Users with many API keys (potential abuse)
SELECT
  u.id as user_id,
  u.email,
  u.created_at,
  COUNT(k.id) as api_key_count
FROM auth.users u
JOIN public.user_api_keys k ON k.user_id = u.id
GROUP BY u.id, u.email, u.created_at
HAVING COUNT(k.id) > 5
ORDER BY api_key_count DESC;

-- 2. Users created very recently (last 24h) with multiple keys
SELECT
  u.id as user_id,
  u.email,
  u.created_at,
  COUNT(k.id) as api_key_count,
  ARRAY_AGG(k.prefix || '...' || k.last4) as keys
FROM auth.users u
JOIN public.user_api_keys k ON k.user_id = u.id
WHERE u.created_at > NOW() - INTERVAL '24 hours'
GROUP BY u.id, u.email, u.created_at
HAVING COUNT(k.id) > 1
ORDER BY u.created_at DESC;

-- 3. Users with suspiciously long names or unusual patterns
SELECT
  u.id,
  u.email,
  u.created_at,
  p.username
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE u.email ILIKE '%test%'
   OR u.email ILIKE '%fake%'
   OR u.email ILIKE '%dummy%'
   OR u.email ILIKE '%admin%'
   OR LENGTH(u.email) < 5
ORDER BY u.created_at DESC;

-- 4. Active API keys per user (should be max 2)
SELECT
  u.id as user_id,
  u.email,
  COUNT(k.id) as active_keys
FROM auth.users u
JOIN public.user_api_keys k ON k.user_id = u.id AND k.status = 'active'
GROUP BY u.id, u.email
HAVING COUNT(k.id) > 2
ORDER BY active_keys DESC;