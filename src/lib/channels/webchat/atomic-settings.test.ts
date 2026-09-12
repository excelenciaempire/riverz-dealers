import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';

it('keeps every field across 100 concurrent partial saves and restricts RPC access', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE channel_connections (workspace_id uuid, channel text, label text, config jsonb, status text, updated_at timestamptz);
      CREATE UNIQUE INDEX uq_webchat_connection_per_workspace ON channel_connections(workspace_id) WHERE channel='webchat';`);
    const sql = readFileSync('supabase/migrations/260_webchat_atomic_settings.sql','utf8');
    await db.exec(sql); await db.exec(sql);
    const ws = '11111111-1111-1111-1111-111111111111';
    await Promise.all(Array.from({length:100}, (_,i) => db.query('SELECT update_webchat_settings($1,$2)', [ws,JSON.stringify({['field'+i]:i})])));
    await db.query('SELECT update_webchat_settings($1,$2)', [ws,JSON.stringify({enabled:true})]);
    const {rows} = await db.query<{config:Record<string,unknown>;status:string}>('SELECT config,status FROM channel_connections');
    expect(rows).toHaveLength(1); expect(Object.keys(rows[0].config)).toHaveLength(101); expect(rows[0].status).toBe('connected');
    await db.exec('SET ROLE anon');
    await expect(db.query('SELECT update_webchat_settings($1,$2)', [ws,'{}'])).rejects.toThrow(/permission denied/);
  } finally { await db.close(); }
}, 15000);
