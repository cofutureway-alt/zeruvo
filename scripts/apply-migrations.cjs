// Applies supabase/migrations/*.sql to the production project via the
// Management API SQL endpoint, oldest first, then records each version in
// supabase_migrations.schema_migrations (same as the CLI would).
// Reads SUPABASE_ACCESS_TOKEN from E:/biforest/.env.local — never printed.
const fs = require('fs');
const path = require('path');

const env = fs.readFileSync('E:/biforest/.env.local', 'utf8');
const token = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const ref = 'unacmcjzwxoyerllvdmt';
if (!token) { console.error('NO_TOKEN'); process.exit(1); }

const dir = 'E:/biforest/supabase/migrations';
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const todo = [
  '20260919010000_wallet.sql',
  '20260919020000_rate_limits.sql',
  '20260919030000_billing_engine.sql',
  '20260919040000_google_signup_guard.sql',
  '20260919050000_pricing_ux_fixes.sql',
  '20260919110000_credit_offers.sql',
  '20260919120000_audit_fixes.sql',
  '20260919130000_catalog_visibility.sql',
  '20260921000000_admin_provider_columns.sql',
  '20260921140000_resolve_alias_parent_id.sql',
  '20260921150000_alias_aware_billing.sql',
];

async function query(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.text();
  return { status: res.status, body };
}

(async () => {
  // migration 1 already applied successfully (HTTP 201 earlier) — record it
  await query(
    `insert into supabase_migrations.schema_migrations(version, name, statements) values ('20260919000000', '20260919000000_payg_models_vendors.sql', null) on conflict (version) do nothing;`,
  );
  // skip versions that already ran (previous partial success)
  const done = await query(`select version from supabase_migrations.schema_migrations where version like '20260919%';`);
  let applied = [];
  try { applied = JSON.parse(done.body).map((r) => String(r.version)); } catch { /* apply all */ }
  for (const name of todo) {
    if (!files.includes(name)) { console.error('MISSING FILE', name); process.exit(1); }
    const version = name.split('_')[0];
    if (applied.includes(version)) { console.log(`skipping ${name} (recorded)`); continue; }
    const sql = fs.readFileSync(path.join(dir, name), 'utf8');
    process.stdout.write(`applying ${name} ... `);
    const r = await query(sql);
    const failed = (r.status !== 200 && r.status !== 201) || /"error"/i.test(r.body.slice(0, 400));
    if (failed) {
      console.log('FAILED', r.status);
      console.error(r.body.slice(0, 1200));
      process.exit(1);
    }
    console.log('ok');
    // record in schema_migrations (best effort)
    const rec = await query(
      `insert into supabase_migrations.schema_migrations(version, name, statements) values ('${version}', '${name.replace(/'/g, "''")}', null) on conflict (version) do nothing;`,
    );
    if (rec.status !== 200 && rec.status !== 201) console.log(`  (migration record skipped: ${rec.status})`);
  }
  console.log('ALL_MIGRATIONS_APPLIED');
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
