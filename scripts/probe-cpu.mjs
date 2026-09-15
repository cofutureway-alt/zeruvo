/**
 * Isolate the exceededCpu kills seen live on api.zeruvo.online: replay bodies of
 * growing size + nested-object shapes against a mock-backed model, measure
 * per-request outcome (status, whether [DONE] arrived, timing).
 */
import fs from 'fs';
const env = fs.readFileSync('.env.local', 'utf8');
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)[1].trim();
const svc = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim();
const dekB64 = env.match(/NEXOR_ENCRYPTION_KEY=(.+)/)[1].trim();
const GW = 'https://api.zeruvo.online';
const MOCK = 'https://nexor-mock-llm.alammmedd4.workers.dev/v1';
const H = { apikey: svc, Authorization: `Bearer ${svc}`, 'Content-Type': 'application/json' };
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
async function encryptKey(p) {
  const raw = Buffer.from(dekB64, 'base64');
  const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt']);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, new TextEncoder().encode(p));
  return b64(Buffer.concat([Buffer.from(nonce), Buffer.from(ct)]));
}
async function insert(resource, row) {
  const r = await fetch(`${url}/rest/v1/${resource}`, { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(row) });
  if (!r.ok) throw new Error(`${resource}: ${r.status} ${await r.text()}`);
  return (await r.json())[0];
}
const uid = (await (await fetch(`${url}/auth/v1/admin/users`, { method: 'POST', headers: H, body: JSON.stringify({ email: `cpu-${Date.now()}@nexor.dev`, password: 'Demo1234!pass', email_confirm: true }) })).json()).id;
const rawKey = 'sk-nexor-' + crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawKey))).toString('hex');
await insert('user_api_keys', { user_id: uid, name: 'probe', prefix: rawKey.slice(0, 12), last4: rawKey.slice(-4), sha256_hash: hash });
await fetch(`${url}/rest/v1/subscriptions?user_id=eq.${uid}`, { method: 'DELETE', headers: H });
const plan = await insert('plans', { name: { en: 'cpu-probe' }, description: {}, daily_weighted_tokens: 1_000_000_000, price_usd: 0, duration_unit: 'days', duration_count: 30, is_free: true, active: false });
await insert('subscriptions', { user_id: uid, plan_id: plan.id, expires_at: new Date(Date.now() + 864e5).toISOString(), status: 'active' });
const prov = await insert('providers', { kind: 'custom', display_name: 'cpu-probe-p', base_url: MOCK, status: 'active' });
await insert('provider_keys', { provider_id: prov.id, label: 'k', encrypted_key: await encryptKey('mock-ok'), weight: 1 });
const mid = `cpu-probe-${Date.now()}`;
await insert('models', { provider_id: prov.id, upstream_model_id: mid, display_name: mid, usage_multiplier: 2, enabled_for_users: true, slug: `${mid}-p`, context_window: 8192 });

/** nested object content — Cline's tool_result shape forces JSON.stringify per message */
function objBody(kb) {
  const blobs = [];
  let size = 0;
  while (size < kb * 1024) {
    const c = 'x'.repeat(8 * 1024);
    blobs.push({ type: 'text', text: c });
    blobs.push({ type: 'tool_result', content: [{ type: 'text', text: c }], tool_use_id: 't' + blobs.length });
    size += 16 * 1024;
  }
  return JSON.stringify({ model: mid, stream: true, messages: [{ role: 'user', content: blobs }] });
}
/** plain-string content — same size, no nested stringify */
function strBody(kb) {
  return JSON.stringify({ model: mid, stream: true, messages: [{ role: 'user', content: 'x'.repeat(kb * 1024) }] });
}
async function fire(label, body) {
  const t0 = Date.now();
  try {
    const res = await fetch(GW + '/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${rawKey}`, 'Content-Type': 'application/json' }, body });
    const text = await res.text();
    console.log(`${label.padEnd(26)} ${(body.length / 1024).toFixed(0)}KB → HTTP ${res.status} ${text.includes('[DONE]') ? '+DONE' : (text.match(/"error"[^}]+/)?.[0] ?? 'no-stream').slice(0, 60)} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (e) {
    console.log(`${label.padEnd(26)} ${(body.length / 1024).toFixed(0)}KB → FETCH ${e.message} after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
}
for (const kb of [100, 200, 300, 470]) await fire(`string ${kb}KB`, strBody(kb));
for (const kb of [100, 200, 300, 470]) await fire(`nested ${kb}KB`, objBody(kb));
await fetch(`${url}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: H });
await fetch(`${url}/rest/v1/plans?id=eq.${plan.id}`, { method: 'DELETE', headers: H });
await fetch(`${url}/rest/v1/models?upstream_model_id=eq.${mid}`, { method: 'DELETE', headers: H });
await fetch(`${url}/rest/v1/providers?id=eq.${prov.id}`, { method: 'DELETE', headers: H });
