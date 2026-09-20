import { beforeAll, afterAll, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const db = new PGlite();
const ws = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const conversation = '00000000-0000-4000-8000-000000000003';
const message = '00000000-0000-4000-8000-000000000004';
beforeAll(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE TABLE workspaces(id uuid PRIMARY KEY);
    CREATE TABLE conversations(id uuid PRIMARY KEY);
    CREATE TABLE messages(id uuid PRIMARY KEY);
    CREATE FUNCTION public.is_workspace_member(id uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT id::text = current_setting('test.workspace', true) $$;
    INSERT INTO workspaces VALUES('${ws}'),('${other}');
    INSERT INTO conversations VALUES('${conversation}');
    INSERT INTO messages VALUES('${message}');`);
  const sql = readFileSync(
    'supabase/migrations/265_dashboard_outcomes.sql',
    'utf8'
  );
  await db.exec(sql);
  await db.exec(sql); // Safe to retry a deployment.
  await db.exec(
    `INSERT INTO conversation_outcomes(conversation_id, workspace_id, last_message_id, category) VALUES('${conversation}','${ws}','${message}','tracking')`
  );
}, 30_000);
afterAll(async () => db.close());

it('allows workspace members to read only their own evidence', async () => {
  await db.exec(`SET ROLE authenticated; SET test.workspace = '${ws}'`);
  expect(
    (await db.query('SELECT * FROM conversation_outcomes')).rows
  ).toHaveLength(1);
  await db.exec(`SET test.workspace = '${other}'`);
  expect(
    (await db.query('SELECT * FROM conversation_outcomes')).rows
  ).toHaveLength(0);
  await db.exec('RESET ROLE');
});
it('does not allow clients to fabricate or delete verification directly', async () => {
  await db.exec(`SET ROLE authenticated; SET test.workspace = '${ws}'`);
  await expect(
    db.exec("UPDATE conversation_outcomes SET category='other'")
  ).rejects.toThrow(/permission denied/);
  await expect(db.exec('DELETE FROM conversation_outcomes')).rejects.toThrow(
    /permission denied/
  );
  await db.exec('RESET ROLE');
});
it('has no anonymous access', async () => {
  await db.exec('SET ROLE anon');
  await expect(db.query('SELECT * FROM conversation_outcomes')).rejects.toThrow(
    /permission denied/
  );
  await db.exec('RESET ROLE');
});
