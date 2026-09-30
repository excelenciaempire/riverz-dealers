import { readFile } from 'node:fs/promises';
const project = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
if (!process.env.SUPABASE_ACCESS_TOKEN) throw new Error('SUPABASE_ACCESS_TOKEN is required.');
const sql = await readFile(new URL('../supabase/migrations/310_inbox_order_actions.sql', import.meta.url), 'utf8');
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
  method: 'POST', headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: `BEGIN;\n${sql}\nCOMMIT;` }), signal: AbortSignal.timeout(60000),
});
if (!response.ok) throw new Error(`Inbox order actions migration failed (HTTP ${response.status}).`);
console.log('Migration 310 applied atomically.');
