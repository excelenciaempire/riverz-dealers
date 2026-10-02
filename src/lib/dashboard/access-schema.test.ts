import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
const db = new PGlite();
const ws = '00000000-0000-4000-8000-000000000001', actor = '00000000-0000-4000-8000-000000000002';
const other = '00000000-0000-4000-8000-000000000003', contact = '00000000-0000-4000-8000-000000000004';
const cc = '00000000-0000-4000-8000-000000000005', c = '00000000-0000-4000-8000-000000000006';
const customer = '00000000-0000-4000-8000-000000000007', last = '00000000-0000-4000-8000-000000000008';
const newer = '00000000-0000-4000-8000-000000000009';
const scalar = async (sql: string, args: unknown[] = []) => Object.values((await db.query(sql, args)).rows[0] as Record<string, unknown>)[0];
const visible = (who = actor) => scalar('SELECT visible_dashboard_cases($1,$2)', [ws, who]);
const save = (category: string | null = 'tracking', who = actor, observed = last) => scalar('SELECT write_dashboard_outcome($1,$2,$3,$4,$5)', [ws, who, c, observed, category]);
beforeAll(async () => {
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
  CREATE TABLE auth.users(id uuid PRIMARY KEY);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
  CREATE TABLE workspaces(id uuid PRIMARY KEY,owner_id uuid,deleted_at timestamptz,writable boolean DEFAULT true);
  CREATE TABLE workspace_members(workspace_id uuid,user_id uuid,role text,allowed_sections jsonb);
  CREATE TABLE contacts(id uuid PRIMARY KEY,workspace_id uuid,name text);
  CREATE TABLE channel_connections(id uuid PRIMARY KEY,workspace_id uuid,channel text,created_by uuid);
  CREATE TABLE conversations(id uuid PRIMARY KEY,workspace_id uuid REFERENCES workspaces(id),contact_id uuid,connection_id uuid,
    channel text,deleted_at timestamptz,needs_human_at timestamptz);
  CREATE TABLE messages(id uuid PRIMARY KEY,conversation_id uuid REFERENCES conversations(id),sender_type text,origin text,status text,created_at timestamptz,deleted_at timestamptz);
  CREATE TABLE conversation_outcomes(conversation_id uuid PRIMARY KEY REFERENCES conversations(id),workspace_id uuid,last_message_id uuid,
    category text,verified_by uuid,verified_at timestamptz);
  ALTER TABLE conversation_outcomes ENABLE ROW LEVEL SECURITY;
  CREATE POLICY conversation_outcomes_read ON conversation_outcomes FOR SELECT TO authenticated USING(true);
  GRANT USAGE ON SCHEMA auth TO authenticated;GRANT SELECT ON conversation_outcomes TO authenticated;
  CREATE FUNCTION workspace_billing_write_allowed(id uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT writable FROM public.workspaces WHERE workspaces.id=$1 $$;`);
  await db.exec(readFileSync('supabase/migrations/358_dashboard_case_authority.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/359_dashboard_human_evidence.sql', 'utf8'));
}, 30_000);
beforeEach(async () => {
  await db.exec('RESET ROLE;TRUNCATE conversation_outcome_events,conversation_outcomes,messages,conversations,channel_connections,contacts,workspace_members,workspaces,auth.users CASCADE');
  await db.query('INSERT INTO auth.users VALUES($1),($2)', [actor, other]);
  await db.query('INSERT INTO workspaces(id,owner_id) VALUES($1,$2),($3,$3)', [ws, actor, other]);
  await db.query("INSERT INTO workspace_members VALUES($1,$2,'agent',null),($1,$3,'admin',null)", [ws, actor, other]);
  await db.query("INSERT INTO contacts VALUES($1,$2,'Synthetic contact')", [contact, ws]);
  await db.query("INSERT INTO channel_connections VALUES($1,$2,'whatsapp',$3)", [cc, ws, actor]);
  await db.query("INSERT INTO conversations(id,workspace_id,contact_id,connection_id,channel) VALUES($1,$2,$3,$4,'whatsapp')", [c, ws, contact, cc]);
  await db.query("INSERT INTO messages VALUES($1,$3,'customer',null,'delivered','2026-09-30T10:00Z',null),($2,$3,'bot','ai_agent','sent','2026-09-30T10:01Z',null)", [customer, last, c]);
});
afterAll(async () => db.close());
describe('current dashboard case authority', () => {
  it('publishes a fixed private schema contract', async () => {
    expect(await scalar('SELECT dashboard_case_authority_ready()')).toBe(true);
    expect(await scalar('SELECT dashboard_human_evidence_ready()')).toBe(true);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      await expect(visible()).rejects.toThrow('permission denied');
      await expect(save()).rejects.toThrow('permission denied');
      await expect(db.query('SELECT * FROM conversation_outcome_events')).rejects.toThrow('permission denied');
      await db.exec('RESET ROLE');
    }
  });
  it('lets the workspace owner read without a membership row', async () => {
    await db.exec('DELETE FROM workspace_members');
    expect(await visible()).toEqual([c]);
    await expect(visible(other)).rejects.toThrow('dashboard_forbidden');
  });
  it.each(['revoked', 'section', 'malformed', 'role', 'workspace_deleted'])('fails current actor scope: %s', async kind => {
    await db.query('UPDATE workspaces SET owner_id=$1 WHERE id=$2', [other, ws]);
    if (kind === 'revoked') await db.query('DELETE FROM workspace_members WHERE user_id=$1', [actor]);
    if (kind === 'section') await db.exec(`UPDATE workspace_members SET allowed_sections='["/panel"]'`);
    if (kind === 'malformed') await db.exec(`UPDATE workspace_members SET allowed_sections='{}'`);
    if (kind === 'role') await db.exec("UPDATE workspace_members SET role='viewer'");
    if (kind === 'workspace_deleted') await db.exec('UPDATE workspaces SET deleted_at=now()');
    await expect(visible()).rejects.toThrow('dashboard_forbidden');
    await expect(save()).rejects.toThrow('dashboard_outcome_not_found');
  });
  it.each(['gmail', 'outlook', 'zoho'])('keeps %s private even from another admin and the workspace owner', async channel => {
    await db.query('UPDATE conversations SET channel=$1', [channel]);
    await db.query('UPDATE channel_connections SET channel=$1,created_by=$2', [channel, other]);
    expect(await visible()).toEqual([]); expect(await visible(other)).toEqual([c]);
    await expect(save()).rejects.toThrow('dashboard_outcome_not_found');
    await save('tracking', other);
  });
  it.each(['contact_workspace', 'connection_workspace', 'channel_mismatch', 'deleted', 'unknown_channel'])('excludes incoherent sources: %s', async kind => {
    if (kind === 'contact_workspace') await db.query('UPDATE contacts SET workspace_id=$1', [other]);
    if (kind === 'connection_workspace') await db.query('UPDATE channel_connections SET workspace_id=$1', [other]);
    if (kind === 'channel_mismatch') await db.exec("UPDATE channel_connections SET channel='instagram'");
    if (kind === 'deleted') await db.exec('UPDATE conversations SET deleted_at=now()');
    if (kind === 'unknown_channel') await db.exec("UPDATE conversations SET channel='unknown'");
    expect(await visible()).toEqual([]); await expect(save()).rejects.toThrow('dashboard_outcome_not_found');
  });
  it('accepts current public comment channels and cursor bounds', async () => {
    await db.exec("UPDATE conversations SET channel='ig_comment';UPDATE channel_connections SET channel='ig_comment'");
    expect(await visible()).toEqual([c]);
    expect(await scalar('SELECT visible_dashboard_cases($1,$2,$3)', [ws, actor, c])).toEqual([]);
  });
  it('records a manual review once, with the authenticated actor, and audits withdrawal', async () => {
    await save(); await save();
    expect(await scalar('SELECT count(*) FROM conversation_outcome_events')).toBe(1);
    expect(await scalar('SELECT verified_by FROM conversation_outcomes')).toBe(actor);
    await save(null); await save(null);
    expect(await scalar('SELECT count(*) FROM conversation_outcomes')).toBe(0);
    expect(await scalar('SELECT count(*) FROM conversation_outcome_events')).toBe(2);
  });
  it('allows an authorized teammate review without financial administrator privileges', async () => {
    await db.query('UPDATE workspaces SET owner_id=$1 WHERE id=$2', [other, ws]);
    expect(await save()).toEqual({ ok: true });
  });
  it('rejects stale submissions and stale withdrawal without removing the current review', async () => {
    await save();
    await db.query("INSERT INTO messages VALUES($1,$2,'customer',null,'delivered','2026-09-30T10:02Z',null)", [newer, c]);
    await expect(save()).rejects.toThrow('dashboard_outcome_changed');
    await expect(save(null)).rejects.toThrow('dashboard_outcome_changed');
    expect(await scalar('SELECT count(*) FROM conversation_outcomes')).toBe(1);
  });
  it.each(['human', 'deleted_human', 'escalated', 'failed_bot', 'no_customer', 'deleted_bot'])('rejects unsupported resolution evidence: %s', async kind => {
    if (kind === 'human' || kind === 'deleted_human') await db.query("INSERT INTO messages VALUES($1,$2,'agent',null,'sent','2026-09-30T09:00Z',$3)", [newer, c, kind === 'deleted_human' ? '2026-09-30T09:01Z' : null]);
    if (kind === 'escalated') await db.exec('UPDATE conversations SET needs_human_at=now()');
    if (kind === 'failed_bot') await db.exec("UPDATE messages SET status='failed' WHERE sender_type='bot'");
    if (kind === 'no_customer') await db.exec("DELETE FROM messages WHERE sender_type='customer'");
    if (kind === 'deleted_bot') await db.exec("UPDATE messages SET deleted_at=now() WHERE sender_type='bot'");
    await expect(save()).rejects.toThrow('dashboard_outcome_changed');
    expect(await scalar('SELECT count(*) FROM conversation_outcome_events')).toBe(0);
  });
  it('allows reads in billing read-only mode and blocks review changes', async () => {
    await db.exec('UPDATE workspaces SET writable=false');
    expect(await visible()).toEqual([c]); await expect(save()).rejects.toThrow('subscription_read_only');
  });
  it('checks signed-in identity for direct authenticated reads after mailbox reassignment', async () => {
    await save();
    await db.exec("UPDATE conversations SET channel='gmail';UPDATE channel_connections SET channel='gmail'");
    await db.exec(`SET ROLE authenticated;SET test.actor='${other}'`);
    expect((await db.query('SELECT * FROM conversation_outcomes')).rows).toHaveLength(0);
    await db.exec(`SET test.actor='${actor}'`);
    expect((await db.query('SELECT * FROM conversation_outcomes')).rows).toHaveLength(1);
    await db.exec('RESET ROLE');
  });
  it('keeps audit events after the reviewer account is deleted', async () => {
    await save(); await db.query('DELETE FROM auth.users WHERE id=$1', [actor]);
    expect(await scalar('SELECT actor_id FROM conversation_outcome_events')).toBeNull();
    expect(await scalar('SELECT observed_message_id FROM conversation_outcome_events')).toBe(last);
  });
});
