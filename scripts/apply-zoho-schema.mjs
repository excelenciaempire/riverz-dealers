// Run with node --env-file=.env.local scripts/apply-zoho-schema.mjs.
// SUPABASE_ACCESS_TOKEN must have management access to this project.
import { readFile } from 'node:fs/promises';

const project = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is required.');
const migration = await readFile(new URL('../supabase/migrations/238_zoho_mail_channel.sql', import.meta.url), 'utf8');
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: `BEGIN;\n${migration}\nCOMMIT;` }),
  signal: AbortSignal.timeout(60_000),
});
if (!response.ok) throw new Error(`Zoho schema migration failed (HTTP ${response.status}).`);
console.log('Migration 238 applied atomically: Zoho enabled for connections, contacts, conversations and messages.');
