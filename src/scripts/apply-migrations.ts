import { supabase } from '../db/client.js';
import { readFileSync } from 'fs';

async function runSql(sql: string, name: string) {
  // Supabase doesn't expose DDL via client SDK directly.
  // Use pg endpoint via fetch with service key.
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_KEY!;

  const res = await fetch(`${url}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': key,
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({ sql }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.log(`${name}: FAILED —`, err);
  } else {
    console.log(`${name}: ✓`);
  }
}

const sql004 = readFileSync('./src/db/migrations/004_pattern_catalog.sql', 'utf-8');
const sql005 = readFileSync('./src/db/migrations/005_pattern_signals.sql', 'utf-8');

await runSql(sql004, '004_pattern_catalog');
await runSql(sql005, '005_pattern_signals');
