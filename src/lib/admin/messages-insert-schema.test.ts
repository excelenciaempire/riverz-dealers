import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('denies anonymous/cross-account inserts while preserving authorized user and server inserts', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE TABLE messages (workspace_id text, body text); ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
      GRANT ALL ON messages TO anon, authenticated, service_role;
      CREATE POLICY "Members can view workspace messages" ON messages TO authenticated USING (workspace_id = current_setting('app.workspace',true));
      CREATE POLICY "Service role can insert messages" ON messages FOR INSERT WITH CHECK (true);`);
    const sql=readFileSync('supabase/migrations/261_messages_insert_policy.sql','utf8');
    await db.exec(sql); await db.exec(sql);
    await db.exec('SET ROLE anon');
    await expect(db.query("INSERT INTO messages VALUES ('other','injected')")).rejects.toThrow(/row-level security/);
    await db.exec("RESET ROLE; SET app.workspace='own'; SET ROLE authenticated;");
    await db.query("INSERT INTO messages VALUES ('own','legitimate')");
    await expect(db.query("INSERT INTO messages VALUES ('other','injected')")).rejects.toThrow(/row-level security/);
    await db.exec('RESET ROLE; SET ROLE service_role');
    await db.query("INSERT INTO messages VALUES ('other','server')");
    expect((await db.query('SELECT * FROM messages')).rows).toHaveLength(2);
  } finally {await db.close();}
},15000);
