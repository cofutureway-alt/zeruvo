// Posts a SQL file to the Management API query endpoint and prints the result.
// Usage: node scripts/run-sql.cjs <file.sql>
const fs = require('fs');

const env = fs.readFileSync('E:/biforest/.env.local', 'utf8');
const token = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const ref = 'unacmcjzwxoyerllvdmt';
if (!token) { console.error('NO_TOKEN'); process.exit(1); }

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/run-sql.cjs <file.sql>'); process.exit(1); }

const sql = fs.readFileSync(file, 'utf8');

(async () => {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.text();
  console.log('STATUS', res.status);
  console.log(body.slice(0, 4000));
})();
