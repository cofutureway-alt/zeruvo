/**
 * Hypothesis: qwen3.8-flash on pi.b.ai applies a small provider-default
 * max_tokens (reasoning eats it) → long tool-call JSON truncated mid-string
 * ("Unterminated string" in Kilo). Test: force big outputs with/without
 * explicit max_tokens and read finish_reason + completion length.
 */
import fs from 'fs';
const env = fs.readFileSync('.env.local', 'utf8');
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)[1].trim();
const svc = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim();
const dekB64 = env.match(/NEXOR_ENCRYPTION_KEY=(.+)/)[1].trim();
const GW = 'https://api.zeruvo.online';
const MOCK = 'https://nexor-mock-llm.alammmedd4.workers.dev/v1';
const H = { apikey: svc, Authorization: `Bearer ${svc}`, 'Content-Type': 'application/json' };
async function encryptKey(p) {
  const raw = Buffer.from(dekB64, 'base64');
  const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt']);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, new TextEncoder().encode(p));
  return Buffer.from(Buffer.concat([Buffer.from(nonce), Buffer.from(ct)])).toString('base64');
}
async function insert(resource, row) {
  const r = await fetch(`${url}/rest/v1/${resource}`, { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(row) });
  if (!r.ok) throw new Error(`${resource}: ${r.status} ${await r.text()}`);
  return (await r.json())[0];
}
const uid = (await (await fetch(`${url}/auth/v1/admin/users`, { method: 'POST', headers: H, body: JSON.stringify({ email: `mt-${Date.now()}@nexor.dev`, password: 'Demo1234!pass', email_confirm: true }) })).json()).id;
const rawKey = 'sk-nexor-' + crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawKey))).toString('hex');
await insert('user_api_keys', { user_id: uid, name: 'mt', prefix: rawKey.slice(0, 12), last4: rawKey.slice(-4), sha256_hash: hash });
await fetch(`${url}/rest/v1/subscriptions?user_id=eq.${uid}`, { method: 'DELETE', headers: H });
const plan = await insert('plans', { name: { en: 'mt-probe' }, description: {}, daily_weighted_tokens: 1_000_000_000, price_usd: 0, duration_unit: 'days', duration_count: 30, is_free: true, active: false });
await insert('subscriptions', { user_id: uid, plan_id: plan.id, expires_at: new Date(Date.now() + 864e5).toISOString(), status: 'active' });

async function call(body, label) {
  const t0 = Date.now();
  const res = await fetch(GW + '/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${rawKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'qwen3.8-flash', ...body }) });
  const text = await res.text();
  // aggregate mode (stream:false) → single JSON doc (strip keep-alive whitespace)
  let fr = '?', completion = -1;
  try {
    const j = JSON.parse(text.replace(/^\s+/, ''));
    fr = j.choices?.[0]?.finish_reason ?? j.choices?.[0]?.[0]?.finishReason ?? '?';
    completion = j.usage?.completion_tokens ?? -1;
  } catch { console.log(label, 'NON-JSON/STREAM head:', text.slice(0, 120)); }
  console.log(`${label.padEnd(34)} finish=${fr.padEnd(8)} completion_tokens=${String(completion).padEnd(6)} bytes=${text.length} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
const ask = 'Output ONLY a JSON object {"data":"..."} where the data string is the word token repeated 6000 times separated by spaces. No explanation, no markdown fences.';
await call({ messages: [{ role: 'user', content: ask }], stream: false }, 'no max_tokens (provider default)');
await call({ messages: [{ role: 'user', content: ask }], max_tokens: 16000, stream: false }, 'max_tokens=16000');
await call({ messages: [{ role: 'user', content: ask }], max_tokens: 40000, stream: false }, 'max_tokens=40000');

await fetch(`${url}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: H });
await fetch(`${url}/rest/v1/plans?id=eq.${plan.id}`, { method: 'DELETE', headers: H });
