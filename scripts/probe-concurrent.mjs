/** Burst test: N concurrent large-body requests → do some die exceededCpu? */
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
const uid = (await (await fetch(`${url}/auth/v1/admin/users`, { method: 'POST', headers: H, body: JSON.stringify({ email: `cc-${Date.now()}@nexor.dev`, password: 'Demo1234!pass', email_confirm: true }) })).json()).id;
const rawKey = 'sk-nexor-' + crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawKey))).toString('hex');
await insert('user_api_keys', { user_id: uid, name: 'cc', prefix: rawKey.slice(0, 12), last4: rawKey.slice(-4), sha256_hash: hash });
await fetch(`${url}/rest/v1/subscriptions?user_id=eq.${uid}`, { method: 'DELETE', headers: H });
const plan = await insert('plans', { name: { en: 'cc-probe' }, description: {}, daily_weighted_tokens: 1_000_000_000, price_usd: 0, duration_unit: 'days', duration_count: 30, is_free: true, active: false });
await insert('subscriptions', { user_id: uid, plan_id: plan.id, expires_at: new Date(Date.now() + 864e5).toISOString(), status: 'active' });
const prov = await insert('providers', { kind: 'custom', display_name: 'cc-probe-p', base_url: MOCK, status: 'active' });
await insert('provider_keys', { provider_id: prov.id, label: 'k', encrypted_key: await encryptKey('mock-ok'), weight: 1 });
const mid = `cc-probe-${Date.now()}`;
await insert('models', { provider_id: prov.id, upstream_model_id: mid, display_name: mid, usage_multiplier: 2, enabled_for_users: true, slug: `${mid}-p`, context_window: 8192 });

function bigBody(kb) {
  const blobs = [];
  let size = 0;
  while (size < kb * 1024) { blobs.push({ type: 'text', text: 'x'.repeat(16 * 1024) }); size += 16 * 1024; }
  return JSON.stringify({ model: mid, stream: true, messages: [{ role: 'user', content: blobs }] });
}
async function fire(i, body) {
  const t0 = Date.now();
  try {
    const res = await fetch(GW + '/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${rawKey}`, 'Content-Type': 'application/json' }, body });
    const text = await res.text();
    return `#${i} ${res.status}${text.includes('[DONE]') ? ' DONE' : ' ' + (text.match(/"type":"[^"]+"/)?.[0] ?? 'TRUNC?')}'} `;
  } catch (e) {
    return `#${i} FETCH-FAIL ${e.message} @${((Date.now() - t0) / 1000).toFixed(1)}s`;
  }
}
const BODIES = [bigBody(300), bigBody(470), bigBody(200), bigBody(470), bigBody(300), bigBody(200), bigBody(470), bigBody(300)];
console.log('firing', BODIES.length, 'concurrent 200-470KB requests…');
const results = await Promise.all(BODIES.map((b, i) => fire(i, b)));
results.forEach((r) => console.log(r));
await new Promise((r) => setTimeout(r, 3000));
const logs = await (await fetch(`${url}/rest/v1/request_logs?user_id=eq.${uid}&select=status,error_code,latency_ms&order=created_at.asc`, { headers: H })).json();
console.log('log rows:', logs.length, JSON.stringify(logs));
await fetch(`${url}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: H });
await fetch(`${url}/rest/v1/plans?id=eq.${plan.id}`, { method: 'DELETE', headers: H });
await fetch(`${url}/rest/v1/models?upstream_model_id=eq.${mid}`, { method: 'DELETE', headers: H });
await fetch(`${url}/rest/v1/providers?id=eq.${prov.id}`, { method: 'DELETE', headers: H });
