import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
const db = new PGlite();
const WS = '11111111-1111-4111-8111-111111111111', OWNER = '22222222-2222-4222-8222-222222222222';
const MEMBER = '33333333-3333-4333-8333-333333333333', ID = '44444444-4444-4444-8444-444444444444';
const CONTACT = '55555555-5555-4555-8555-555555555555', CONV = '66666666-6666-4666-8666-666666666666';
const CONN = '77777777-7777-4777-8777-777777777777', OTHER = '88888888-8888-4888-8888-888888888888';
const context = { contact_id: CONTACT, conversation_id: CONV, phone: '+10000000000', email: null };
let revision = 2;
beforeAll(async () => {
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
    CREATE TABLE workspaces(id uuid PRIMARY KEY,owner_id uuid,deleted_at timestamptz);
    CREATE TABLE workspace_members(workspace_id uuid,user_id uuid,role text,allowed_sections text[]);
    CREATE TABLE contacts(id uuid PRIMARY KEY,workspace_id uuid,phone text,email text);
    CREATE TABLE conversations(id uuid PRIMARY KEY,workspace_id uuid,contact_id uuid,channel text,connection_id uuid,deleted_at timestamptz);
    CREATE TABLE channel_connections(id uuid PRIMARY KEY,workspace_id uuid,channel text,created_by uuid);
    CREATE TABLE billing(allowed boolean);INSERT INTO billing VALUES(true);
    CREATE FUNCTION workspace_billing_write_allowed(ws uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT allowed FROM public.billing $$;`);
  await db.exec(readFileSync('supabase/migrations/330_http_action_configuration.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/331_http_action_receipts.sql', 'utf8'));
});
afterAll(async () => db.close());
beforeEach(async () => {
  revision = 2;
  await db.exec('RESET ROLE;TRUNCATE workspaces CASCADE;TRUNCATE workspace_members,contacts,conversations,channel_connections;UPDATE billing SET allowed=true');
  await db.query('INSERT INTO workspaces VALUES($1,$2,NULL)', [WS, OWNER]);
  await db.query("INSERT INTO workspace_members VALUES($1,$2,'agent',NULL)", [WS, MEMBER]);
  await db.query("INSERT INTO contacts VALUES($1,$2,'+10000000000',NULL)", [CONTACT, WS]);
  await db.query("INSERT INTO conversations VALUES($1,$2,$3,'whatsapp',$4,NULL)", [CONV, WS, CONTACT, CONN]);
  await db.query("INSERT INTO channel_connections VALUES($1,$2,'gmail',$3)", [CONN, WS, OWNER]);
  await db.query("INSERT INTO http_actions(id,workspace_id,definition,state,revision,actor_id) VALUES($1,$2,$3,'active',2,$4)",
    [ID, WS, { method: 'GET', credential_kind: 'none' }, OWNER]);
});
type Row = { id: string; lease_id?: string; state: string; claimed?: boolean; result?: unknown };
async function claim(options: { actor?: string; ws?: string; revision?: number; key?: string; hash?: string; confirmed?: boolean; conv?: string; context?: unknown } = {}) {
  return (await db.query<{ result: Row }>('SELECT claim_http_action($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result',
    [options.ws ?? WS, options.actor ?? OWNER, ID, options.revision ?? revision, options.key ?? 'a'.repeat(64), options.hash ?? 'b'.repeat(64),
      options.confirmed ?? false, options.conv ?? null, options.context ?? null])).rows[0].result;
}
async function finish(row: Row, state = 'acknowledged', status: number | null = 200, error: string | null = null, result: unknown = { status: 'received' }) {
  return (await db.query<{ result: Row }>('SELECT finish_http_action($1,$2,$3,$4,$5,$6,$7) AS result',
    [WS, row.id, row.lease_id, state, status, error, result])).rows[0].result;
}
const post = async () => { await db.query("UPDATE http_actions SET definition=jsonb_set(definition,'{method}','\"POST\"'),revision=revision+1"); revision = 3; };
describe('durable HTTP execution SQL', () => {
  it('claims once, hides the lease on replay and confirms a selected result exactly once', async () => {
    const run = await claim(); expect(run).toMatchObject({ claimed: true, state: 'claimed' }); expect(run.lease_id).toBeTruthy();
    const replay = await claim(); expect(replay).toMatchObject({ claimed: false, state: 'claimed', id: run.id }); expect(replay).not.toHaveProperty('lease_id');
    expect(await finish(run)).toMatchObject({ state: 'acknowledged', result: { status: 'received' } });
    expect(await claim()).toMatchObject({ claimed: false, state: 'acknowledged' });
    await expect(finish(run)).rejects.toThrow('http_execution_conflict');
    expect((await db.query('SELECT count(*)::int AS n FROM http_action_runs')).rows).toEqual([{ n: 1 }]);
  });
  it('rejects replay with changed actor, payload or conversation', async () => {
    await claim();
    for (const options of [{ actor: MEMBER }, { hash: 'c'.repeat(64) }, { conv: CONV, context }]) {
      await expect(claim(options)).rejects.toThrow('http_execution_conflict');
    }
  });
  it('requires a current active revision and a current member on every replay', async () => {
    await claim({ actor: MEMBER });
    await db.query('DELETE FROM workspace_members WHERE user_id=$1', [MEMBER]);
    await expect(claim({ actor: MEMBER })).rejects.toThrow('http_execution_forbidden');
    await expect(claim({ revision: 1 })).rejects.toThrow('http_action_changed');
    await db.exec("UPDATE http_actions SET state='withdrawn',revision=revision+1");
    await expect(claim()).rejects.toThrow('invalid_http_execution_context');
  });
  it('blocks foreign or deleted workspaces and invalid invocation hashes', async () => {
    await expect(claim({ ws: OTHER })).rejects.toThrow('invalid_http_execution_context');
    await expect(claim({ key: 'client-generated-token' })).rejects.toThrow('invalid_http_execution_context');
    await db.exec('UPDATE workspaces SET deleted_at=now()');
    await expect(claim()).rejects.toThrow('invalid_http_execution_context');
  });
  it('requires automations access and inbox access for a bound conversation', async () => {
    await db.query("UPDATE workspace_members SET allowed_sections=ARRAY['/bandeja'] WHERE user_id=$1", [MEMBER]);
    await expect(claim({ actor: MEMBER })).rejects.toThrow('http_execution_forbidden');
    await db.query("UPDATE workspace_members SET allowed_sections=ARRAY['/automatizaciones'] WHERE user_id=$1", [MEMBER]);
    await expect(claim({ actor: MEMBER, conv: CONV, context })).rejects.toThrow('http_execution_forbidden');
    expect(await claim({ actor: MEMBER })).toMatchObject({ claimed: true });
  });
  it('requires administrator confirmation and writable billing for POST', async () => {
    await post();
    await expect(claim({ actor: MEMBER, confirmed: true })).rejects.toThrow('http_execution_confirmation_required');
    await expect(claim()).rejects.toThrow('http_execution_confirmation_required');
    await db.exec('UPDATE billing SET allowed=false');
    await expect(claim({ confirmed: true })).rejects.toThrow('subscription_read_only');
    await db.exec('UPDATE billing SET allowed=true');
    expect(await claim({ confirmed: true })).toMatchObject({ claimed: true });
  });
  it('prevents new confirmation keys bypassing a crashed or uncertain POST', async () => {
    await post(); const run = await claim({ confirmed: true });
    await expect(claim({ confirmed: true, key: 'c'.repeat(64) })).rejects.toThrow('http_execution_review_required');
    await finish(run, 'uncertain', null, 'http_timeout', null);
    await expect(claim({ confirmed: true, key: 'd'.repeat(64) })).rejects.toThrow('http_execution_review_required');
    expect(await claim({ confirmed: true, hash: 'e'.repeat(64), key: 'f'.repeat(64) })).toMatchObject({ claimed: true });
  });
  it('never redispatches a blocked invocation but allows a new invocation after pre-dispatch failure', async () => {
    await post(); const run = await claim({ confirmed: true }); await finish(run, 'blocked', null, 'http_destination_forbidden', null);
    expect(await claim({ confirmed: true })).toMatchObject({ claimed: false, state: 'blocked' });
    expect(await claim({ confirmed: true, key: 'c'.repeat(64) })).toMatchObject({ claimed: true });
  });
  it('checks exact current contact identity and mailbox owner before claiming', async () => {
    await expect(claim({ conv: CONV, context: { ...context, phone: '+19999999999' } })).rejects.toThrow('invalid_http_execution_context');
    await db.query("UPDATE conversations SET channel='gmail'");
    await expect(claim({ actor: MEMBER, conv: CONV, context })).rejects.toThrow('invalid_http_execution_context');
    expect(await claim({ conv: CONV, context })).toMatchObject({ claimed: true });
    await db.query('UPDATE contacts SET workspace_id=$1', [OTHER]);
    await expect(claim({ conv: CONV, context })).rejects.toThrow('invalid_http_execution_context');
  });
  it('rejects mismatched leases and workspace identifiers during finalization', async () => {
    const run = await claim(); await expect(finish({ ...run, lease_id: OTHER })).rejects.toThrow('http_execution_conflict');
    await expect(db.query('SELECT finish_http_action($1,$2,$3,$4,$5,$6,$7)', [OTHER, run.id, run.lease_id, 'acknowledged', 200, null, {}])).rejects.toThrow('http_execution_conflict');
    expect(await finish(run)).toMatchObject({ state: 'acknowledged' });
  });
  it('does not accept false acknowledgements, raw errors or excessive results', async () => {
    const run = await claim();
    const invalid: Array<[string, number | null, string | null, unknown]> = [
      ['acknowledged', 500, null, {}], ['acknowledged', 200, null, null], ['blocked', 200, 'http_timeout', null],
      ['uncertain', null, 'PRIVATE_ERROR', null], ['uncertain', null, null, null], ['acknowledged', 200, null, { raw: 'x'.repeat(65537) }]];
    for (const args of invalid) {
      await expect(finish(run, ...args)).rejects.toThrow('invalid_http_execution_receipt');
    }
    expect(await finish(run, 'uncertain', 502, 'http_status_failed', null)).toMatchObject({ state: 'uncertain' });
  });
  it('denies public RPC and direct service writes while allowing service claims', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role}`); await expect(claim()).rejects.toThrow('permission denied');
      await expect(db.query('SELECT * FROM http_action_runs')).rejects.toThrow('permission denied'); await db.exec('RESET ROLE');
    }
    await db.exec('SET ROLE service_role'); const run = await claim();
    await expect(db.query("UPDATE http_action_runs SET state='acknowledged'")).rejects.toThrow('permission denied');
    await expect(db.query('DELETE FROM http_action_runs')).rejects.toThrow('permission denied');
    expect(await finish(run)).toMatchObject({ state: 'acknowledged' }); await db.exec('RESET ROLE');
  });
});
