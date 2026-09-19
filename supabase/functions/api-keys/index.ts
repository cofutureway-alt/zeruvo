// deno-lint-ignore-file no-explicit-any
/**
 * api-keys — Manage user API keys (list, create, delete).
 * Auth: user JWT. Users only ever touch their own keys.
 * Limits: max 2 active keys (also enforced by DB trigger).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
};

const KEY_PREFIX = 'sk-nexor-';
const KEY_LENGTH = 32; // characters after prefix

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Cryptographically secure key generation — never use Math.random for secrets. */
function genKey(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(KEY_LENGTH);
  crypto.getRandomValues(bytes);
  let key = '';
  for (let i = 0; i < KEY_LENGTH; i++) key += chars[bytes[i] % chars.length];
  return KEY_PREFIX + key;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function decrypt(stored: string, dekB64: string): Promise<string> {
  const bytes = b64ToBytes(stored);
  const nonce = bytes.slice(0, 12), ct = bytes.slice(12);
  const raw = b64ToBytes(dekB64);
  const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ct));
}

/** Cloudflare Turnstile server-side verification (when the admin enabled it). */
async function verifyTurnstile(token: unknown): Promise<string | null> {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: settings } = await admin.from('app_settings')
    .select('turnstile_enabled,turnstile_on_api_key').eq('id', 1).maybeSingle();
  if (!settings?.turnstile_enabled || !settings.turnstile_on_api_key) return null; // not required
  if (!token || typeof token !== 'string') return 'captcha required';
  const { data: secretRow } = await admin.from('private_settings')
    .select('value_encrypted').eq('key', 'turnstile_secret').maybeSingle();
  if (!secretRow) return 'captcha not configured';
  let secret: string;
  try {
    secret = await decrypt(secretRow.value_encrypted, Deno.env.get('NEXOR_ENCRYPTION_KEY')!);
  } catch {
    return 'captcha not configured';
  }
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret, response: token }),
  });
  const verdict = await res.json().catch(() => null);
  if (!verdict?.success) return 'captcha verification failed';
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (!['GET', 'POST', 'DELETE'].includes(req.method)) {
    return json({ error: 'method not allowed' }, 405);
  }

  // Cap request body — no reason for key management to send more than 4KB
  const contentLength = Number(req.headers.get('content-length') ?? '0');
  if (contentLength > 4096) return json({ error: 'payload too large' }, 413);

  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: 'unauthorized' }, 401);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  if (req.method === 'GET') {
    // List user's active keys (revoked keys are hidden; permanent delete removes them entirely)
    const { data, error } = await admin.from('user_api_keys')
      .select('id, user_id, name, prefix, last4, allowed_models, rate_limit_per_min, spend_limit_usd, total_spent_usd, status, last_used_at, created_at')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('created_at', { ascending: false });

    if (error) return json({ error: error.message }, 500);
    return json({ keys: data });
  }

  if (req.method === 'POST') {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'invalid json' }, 400);
    }

    if (body.action === 'create') {
      // Human-verification gate on key creation (when enabled by the admin)
      const captchaError = await verifyTurnstile(body.turnstile_token).catch(() => 'captcha check failed');
      if (captchaError) return json({ error: captchaError }, 403);

      // Check active key count — count may be null on error, treat as 0 then re-verify via trigger
      const { count, error: countErr } = await admin.from('user_api_keys')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', 'active');

      if (countErr) return json({ error: countErr.message }, 500);
      if ((count ?? 0) >= 2) {
        return json({ error: 'Maximum 2 active keys per user. Revoke or permanently delete one first.' }, 400);
      }

      const newKey = genKey();
      const hash = await sha256Hex(newKey);

      // spend limit: empty/absent = unlimited (NULL)
      const spendLimit = body.spend_limit_usd == null || body.spend_limit_usd === ''
        ? null
        : Number(body.spend_limit_usd);
      if (spendLimit != null && (!Number.isFinite(spendLimit) || spendLimit < 0)) {
        return json({ error: 'spend_limit_usd must be a positive number or empty' }, 400);
      }

      // DB trigger re-validates the limit — race-safe even if two creates race here
      const { data, error } = await admin.from('user_api_keys')
        .insert({
          user_id: user.id,
          name: typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 64) : 'default',
          prefix: newKey.slice(0, KEY_PREFIX.length + 4),
          last4: newKey.slice(-4),
          sha256_hash: hash,
          allowed_models: Array.isArray(body.allowed_models) ? body.allowed_models : [],
          rate_limit_per_min: Number.isInteger(body.rate_limit_per_min) && body.rate_limit_per_min > 0
            ? Math.min(body.rate_limit_per_min, 600)
            : 60,
          spend_limit_usd: spendLimit,
          status: 'active',
        })
        .select('id, name, prefix, last4, created_at')
        .single();

      if (error) {
        const isLimit = error.message.includes('limited to 2 active');
        return json({ error: isLimit ? 'Maximum 2 active keys per user.' : error.message }, isLimit ? 400 : 500);
      }

      // Return the full key ONCE — only the SHA-256 hash is stored
      return json({ key: newKey, key_id: data.id, name: data.name });
    }

    return json({ error: 'invalid action' }, 400);
  }

  // DELETE — permanent removal (row gone, not just revoked)
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  if (!body.key_id || typeof body.key_id !== 'string') {
    return json({ error: 'key_id required' }, 400);
  }

  // RPC is security-definer and scoped to p_user_id = caller — can't touch other users' keys
  const { data, error } = await admin.rpc('delete_api_key', {
    p_key_id: body.key_id,
    p_user_id: user.id,
  });

  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: 'key not found' }, 404);
  return json({ deleted: true });
});
