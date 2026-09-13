// node --env-file=.env.local scripts/apply-voice-number-billing-schema.mjs
import { readFile } from 'node:fs/promises';
const project = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is required.');
const migration = await readFile(new URL('../supabase/migrations/262_voice_number_billing.sql', import.meta.url), 'utf8');
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: `BEGIN;\n${migration}\nCOMMIT;` }), signal: AbortSignal.timeout(60000),
});
if (!response.ok) throw new Error(`Number billing migration failed (HTTP ${response.status}): ${await response.text()}`);
console.log('Migration 262 applied atomically. Existing numbers were not enrolled or charged.');
