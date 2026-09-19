// One-off: fill missing context windows from OpenRouter's public catalog.
// Same matching logic as the admin-sync-models enrich_context action.
const fs = require('fs');

const env = fs.readFileSync('E:/biforest/.env.local', 'utf8');
const token = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const ref = 'unacmcjzwxoyerllvdmt';
if (!token) { console.error('NO_TOKEN'); process.exit(1); }

async function query(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.text();
  if (res.status !== 200 && res.status !== 201) throw new Error(`query failed ${res.status}: ${body.slice(0, 300)}`);
  return JSON.parse(body || '[]');
}

(async () => {
  const orRes = await fetch('https://openrouter.ai/api/v1/models', {
    headers: { 'HTTP-Referer': 'https://zeruvo.online' },
  });
  if (!orRes.ok) { console.error('openrouter fetch failed', orRes.status); process.exit(1); }
  const orJson = await orRes.json();
  const catalog = new Map();
  for (const m of orJson.data ?? []) {
    if (m.context_length == null) continue;
    const norm = m.id.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!catalog.has(m.id)) catalog.set(m.id, m);
    const short = m.id.split('/').pop() ?? m.id;
    if (!catalog.has(short) && !short.includes(':')) catalog.set(short, m);
    if (!catalog.has(`bare:${short.split(':')[0]}`)) catalog.set(`bare:${short.split(':')[0]}`, m);
    if (!catalog.has(`norm:${norm}`)) catalog.set(`norm:${norm}`, m);
  }
  console.log('openrouter models with context:', catalog.size ? orJson.data.length : 0);

  const targets = await query(
    `select id, upstream_model_id, max_output_tokens from public.models where context_window is null limit 2000;`,
  );
  console.log('models missing context:', targets.length);

  const patches = [];
  for (const t of targets) {
    const id = t.upstream_model_id;
    const short = id.split('/').pop() ?? id;
    const or = catalog.get(id)
      ?? catalog.get(short)
      ?? catalog.get(`bare:${short.split(':')[0]}`)
      ?? catalog.get(`norm:${id.toLowerCase().replace(/[^a-z0-9]/g, '')}`)
      ?? null;
    if (!or) continue;
    const sets = [`context_window = ${Number(or.context_length)}`];
    if (t.max_output_tokens == null && or.top_provider?.max_completion_tokens != null) {
      sets.push(`max_output_tokens = ${Number(or.top_provider.max_completion_tokens)}`);
    }
    patches.push(`update public.models set ${sets.join(', ')} where id = '${t.id}';`);
  }

  console.log('matched:', patches.length);
  if (patches.length) {
    await query('begin;' + patches.join('\n') + 'commit;');
  }

  const after = await query(`select count(*)::int as remaining from public.models where context_window is null;`);
  console.log('still missing context:', after[0]?.remaining);
})();
