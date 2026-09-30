import { afterAll, beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
const ids = { ws: '11111111-1111-1111-1111-111111111111', case: '22222222-2222-2222-2222-222222222222', message: '33333333-3333-3333-3333-333333333333' };
beforeAll(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE workspaces(id uuid PRIMARY KEY); CREATE TABLE conversations(id uuid PRIMARY KEY);
    CREATE TABLE messages(id uuid PRIMARY KEY); INSERT INTO workspaces VALUES('${ids.ws}');
    INSERT INTO conversations VALUES('${ids.case}'); INSERT INTO messages VALUES('${ids.message}');`);
  const sql = readFileSync('supabase/migrations/323_comment_reply_retries.sql', 'utf8');
  await db.exec(sql); await db.exec(sql);
});
afterAll(() => db.close());
it('leases one source comment, never double-claims, and exposes an exhausted abandoned send', async () => {
  await db.exec(`INSERT INTO comment_reply_retries(inbound_message_id,workspace_id,conversation_id,reason,next_attempt_at)
    VALUES('${ids.message}','${ids.ws}','${ids.case}','comment_error',now()-interval '1 minute');`);
  const first = await db.query<{ lease_id: string; attempts: number }>('SELECT * FROM claim_comment_reply_retry()');
  expect(first.rows[0].attempts).toBe(1); expect(first.rows[0].lease_id).toBeTruthy();
  expect((await db.query('SELECT * FROM claim_comment_reply_retry()')).rows).toHaveLength(0);
  await db.exec(`UPDATE comment_reply_retries SET lease_until=now()-interval '1 minute',attempts=3;`);
  expect((await db.query('SELECT * FROM claim_comment_reply_retry()')).rows).toHaveLength(0);
  expect((await db.query('SELECT status,outcome FROM comment_reply_retries')).rows).toEqual([{ status: 'review', outcome: 'dispatch_uncertain' }]);
});
it('keeps retry dispatch unavailable to tenant and anonymous clients', async () => {
  const row = (await db.query<{ can_claim: boolean; can_write: boolean }>(`SELECT
    has_function_privilege('authenticated','claim_comment_reply_retry()','execute') AS can_claim,
    has_table_privilege('authenticated','comment_reply_retries','insert') AS can_write`)).rows[0];
  expect(row).toEqual({ can_claim: false, can_write: false });
});
