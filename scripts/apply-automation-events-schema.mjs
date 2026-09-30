// node --env-file=.env.local scripts/apply-automation-events-schema.mjs
import { readFile } from 'node:fs/promises';

const project = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is required.');
const sql = await readFile(new URL('../supabase/migrations/303_automation_events.sql', import.meta.url), 'utf8');
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: `BEGIN;\n${sql}\nCOMMIT;` }), signal: AbortSignal.timeout(60000),
});
if (!response.ok) throw new Error(`Automation events migration failed (HTTP ${response.status}).`);
console.log('Migration 303 applied atomically.');
