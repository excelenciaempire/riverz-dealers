import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
const db = new PGlite();
const WS = '11111111-1111-4111-8111-111111111111', OWNER = '22222222-2222-4222-8222-222222222222';
const ADMIN = '33333333-3333-4333-8333-333333333333', ACTION = '44444444-4444-4444-8444-444444444444';
const AGENT = '55555555-5555-4555-8555-555555555555', CONV = '66666666-6666-4666-8666-666666666666';
const CONTACT = '77777777-7777-4777-8777-777777777777', APPROVAL = '88888888-8888-4888-8888-888888888888';
const OTHER = '99999999-9999-4999-8999-999999999999';
const context = { contact_id: CONTACT, conversation_id: CONV, phone: '+10000000000', email: null };
const parameters = { reference: 'fixture-reference' };
let revision = 2;
type Row = { id: string; claimed: boolean; state: string; lease_id?: string };
beforeAll(async () => {
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
    CREATE TABLE workspaces(id uuid PRIMARY KEY,owner_id uuid,deleted_at timestamptz);
    CREATE TABLE workspace_members(workspace_id uuid,user_id uuid,role text,allowed_sections text[]);
    CREATE TABLE ai_agents(id uuid PRIMARY KEY,workspace_id uuid,scope text,is_active boolean,assigned_only boolean,deleted_at timestamptz);
    CREATE TABLE ai_agent_channels(agent_id uuid,channel text);
    CREATE TABLE contacts(id uuid PRIMARY KEY,workspace_id uuid,phone text,email text);
    CREATE TABLE conversations(id uuid PRIMARY KEY,workspace_id uuid,contact_id uuid,channel text,connection_id uuid,deleted_at timestamptz,assigned_ai_agent_id uuid);
    CREATE TABLE channel_connections(id uuid PRIMARY KEY,workspace_id uuid,channel text,created_by uuid);
    CREATE TABLE approval_requests(id uuid PRIMARY KEY,workspace_id uuid,kind text,status text,payload jsonb,decided_by text,decided_at timestamptz,expires_at timestamptz);
    CREATE TABLE billing(allowed boolean);INSERT INTO billing VALUES(true);
    CREATE FUNCTION workspace_billing_write_allowed(ws uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT allowed FROM public.billing $$;`);
  for (const name of ['330_http_action_configuration', '331_http_action_receipts', '332_http_action_assistant_grants', '333_http_assistant_execution_claims', '334_http_assistant_approved_identity']) {
    await db.exec(readFileSync(`supabase/migrations/${name}.sql`, 'utf8'));
  }
});
afterAll(async () => db.close());
beforeEach(async () => {
  revision = 2;
  await db.exec('RESET ROLE;TRUNCATE workspaces CASCADE;TRUNCATE workspace_members,ai_agents,ai_agent_channels,contacts,conversations,channel_connections,approval_requests CASCADE;UPDATE billing SET allowed=true');
  await db.query('INSERT INTO workspaces VALUES($1,$2,NULL)', [WS, OWNER]);
  await db.query("INSERT INTO workspace_members VALUES($1,$2,'admin',NULL)", [WS, ADMIN]);
  await db.query("INSERT INTO ai_agents VALUES($1,$2,'workspace',true,false,NULL)", [AGENT, WS]);
  await db.query("INSERT INTO contacts VALUES($1,$2,'+10000000000',NULL)", [CONTACT, WS]);
  await db.query("INSERT INTO conversations VALUES($1,$2,$3,'whatsapp',NULL,NULL,NULL)", [CONV, WS, CONTACT]);
  await db.query("INSERT INTO http_actions(id,workspace_id,definition,state,revision,actor_id) VALUES($1,$2,$3,'active',2,$4)",
    [ACTION, WS, { method: 'GET', credential_kind: 'none', parameters: [{ key: 'customer', source: 'contact_id', type: 'string', required: true }] }, OWNER]);
  await grant();
});
async function grant(actor = OWNER, channel = 'whatsapp', version = 0) {
  return db.query('SELECT manage_http_action_assistant_grant($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [WS, actor, ACTION, 'save', AGENT, channel, 'contact', revision, version]);
}
async function claim(opts: { ws?: string; agent?: string; revision?: number; grant?: number; channel?: string; key?: string; hash?: string; conv?: string; context?: unknown; parameters?: unknown; approval?: string | null; actor?: string | null } = {}) {
  return (await db.query<{ result: Row }>('SELECT claim_http_action_assistant($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) AS result',
    [opts.ws ?? WS, opts.agent ?? AGENT, ACTION, opts.revision ?? revision, opts.channel ?? 'whatsapp', opts.grant ?? 1,
      opts.key ?? 'a'.repeat(64), opts.hash ?? 'b'.repeat(64), opts.conv ?? CONV, opts.context ?? context, opts.parameters ?? parameters,
      opts.approval ?? null, opts.actor ?? null])).rows[0].result;
}
async function post() {
  await db.exec("UPDATE http_actions SET definition=jsonb_set(definition,'{method}','\"POST\"'),revision=3"); revision = 3;
  await grant(OWNER, 'whatsapp', 1);
  await db.query("INSERT INTO approval_requests VALUES($1,$2,'herramienta','aprobada',$3,$4,now(),now()+interval '10 minutes')",
    [APPROVAL, WS, { tool: `http_action_${ACTION.replaceAll('-', '')}_v3`, input: parameters, agent_id: AGENT,
      conversation_id: CONV, contact_id: CONTACT, http_action_context: context,
      http_action: { action_id: ACTION, action_revision: 3, grant_revision: 2, channel: 'whatsapp' } }, OWNER]);
}
const approved = () => ({ approval: APPROVAL, actor: OWNER, grant: 2 });
describe('protected assistant HTTP execution claims', () => {
  it('records the assistant separately from the human who granted permission and replays without a lease', async () => {
    const run = await claim(); expect(run).toMatchObject({ claimed: true, state: 'claimed' }); expect(run.lease_id).toBeTruthy();
    expect((await db.query('SELECT actor_id,source_kind,source_agent_id,source_channel,source_grant_revision,source_approval_id FROM http_action_runs')).rows)
      .toEqual([{ actor_id: OWNER, source_kind: 'assistant', source_agent_id: AGENT, source_channel: 'whatsapp', source_grant_revision: 1, source_approval_id: null }]);
    expect(await claim()).toMatchObject({ claimed: false, id: run.id }); expect(await claim()).not.toHaveProperty('lease_id');
  });
  it('preserves attribution on existing human executions and denies colliding assistant invocations', async () => {
    await db.query('SELECT claim_http_action($1,$2,$3,$4,$5,$6,false,$7,$8)', [WS, OWNER, ACTION, 2, 'a'.repeat(64), 'b'.repeat(64), CONV, context]);
    await expect(claim()).rejects.toThrow('http_execution_conflict');
    expect((await db.query('SELECT source_kind,source_agent_id FROM http_action_runs')).rows).toEqual([{ source_kind: 'human', source_agent_id: null }]);
  });
  it('rechecks both action version and grant version on every attempt', async () => {
    await claim(); await expect(claim({ revision: 1 })).rejects.toThrow('http_action_changed');
    await expect(claim({ grant: 2 })).rejects.toThrow('http_action_changed');
    await grant(OWNER, 'whatsapp', 1); await expect(claim()).rejects.toThrow('http_action_changed');
    await expect(claim({ grant: 2 })).rejects.toThrow('http_execution_conflict');
    await db.query('SELECT manage_http_action_assistant_grant($1,$2,$3,$4,$5,$6,$7,$8,$9)', [WS, OWNER, ACTION, 'withdraw', AGENT, 'whatsapp', null, null, 2]);
    await expect(claim({ grant: 3 })).rejects.toThrow('http_execution_forbidden');
  });
  it('rejects removed or restricted grantors instead of using historical permission', async () => {
    await grant(ADMIN, 'whatsapp', 1); expect(await claim({ grant: 2 })).toMatchObject({ claimed: true });
    await db.exec("UPDATE workspace_members SET allowed_sections=ARRAY['/ajustes','/automatizaciones']");
    await expect(claim({ grant: 2 })).rejects.toThrow('http_execution_forbidden'); // Inbox is also needed for the bound conversation.
    await db.exec('DELETE FROM workspace_members'); await expect(claim({ grant: 2 })).rejects.toThrow('http_execution_forbidden');
  });
  it('rejects paused, deleted, foreign or uncovered assistants', async () => {
    await db.exec('UPDATE ai_agents SET is_active=false'); await expect(claim()).rejects.toThrow('http_execution_forbidden');
    await db.exec("UPDATE ai_agents SET is_active=true,scope='channels'"); await expect(claim()).rejects.toThrow('http_execution_forbidden');
    await db.query("INSERT INTO ai_agent_channels VALUES($1,'whatsapp')", [AGENT]); expect(await claim()).toMatchObject({ claimed: true });
    await db.exec('UPDATE ai_agents SET deleted_at=now()'); await expect(claim()).rejects.toThrow('http_execution_forbidden');
    await expect(claim({ agent: OTHER })).rejects.toThrow('http_execution_forbidden');
  });
  it('binds the current conversation, channel, profile and exact customer snapshot', async () => {
    await expect(claim({ channel: 'webchat' })).rejects.toThrow('http_execution_forbidden');
    await expect(claim({ conv: OTHER })).rejects.toThrow('invalid_http_execution_context');
    await expect(claim({ context: { ...context, phone: '+19999999999' } })).rejects.toThrow('invalid_http_execution_context');
    await db.exec('UPDATE ai_agents SET assigned_only=true'); await expect(claim()).rejects.toThrow('invalid_http_execution_context');
    await db.query('UPDATE conversations SET assigned_ai_agent_id=$1', [AGENT]); expect(await claim()).toMatchObject({ claimed: true });
    await db.query('UPDATE conversations SET assigned_ai_agent_id=$1', [OTHER]); await expect(claim()).rejects.toThrow('invalid_http_execution_context');
  });
  it('keeps personal mailbox execution scoped to the permission principal', async () => {
    await grant(OWNER, 'gmail'); await db.query("UPDATE conversations SET channel='gmail',connection_id=$1", [OTHER]);
    await db.query("INSERT INTO channel_connections VALUES($1,$2,'gmail',$3)", [OTHER, WS, ADMIN]);
    await expect(claim({ channel: 'gmail' })).rejects.toThrow('invalid_http_execution_context');
    await db.query('UPDATE channel_connections SET created_by=$1', [OWNER]); expect(await claim({ channel: 'gmail' })).toMatchObject({ claimed: true });
  });
  it('requires a current exact approved POST and attributes its actual decider', async () => {
    await post(); await expect(claim({ grant: 2 })).rejects.toThrow('http_execution_confirmation_required');
    await expect(claim({ ...approved(), actor: ADMIN })).rejects.toThrow('http_execution_confirmation_required');
    await expect(claim({ ...approved(), parameters: { reference: 'changed' } })).rejects.toThrow('http_execution_confirmation_required');
    expect(await claim(approved())).toMatchObject({ claimed: true });
    expect((await db.query('SELECT actor_id,source_approval_id FROM http_action_runs')).rows).toEqual([{ actor_id: OWNER, source_approval_id: APPROVAL }]);
  });
  it.each(['pending', 'foreign', 'old', 'expired-decision', 'future', 'wrong-version', 'wrong-contact', 'wrong-agent'])('rejects invalid approval: %s', async mode => {
    await post();
    if (mode === 'pending') await db.exec("UPDATE approval_requests SET status='pendiente'");
    if (mode === 'foreign') await db.query('UPDATE approval_requests SET workspace_id=$1', [OTHER]);
    if (mode === 'old') await db.exec("UPDATE approval_requests SET decided_at=now()-interval '6 minutes'");
    if (mode === 'expired-decision') await db.exec("UPDATE approval_requests SET expires_at=now()-interval '1 second'");
    if (mode === 'future') await db.exec("UPDATE approval_requests SET decided_at=now()+interval '1 minute'");
    if (mode === 'wrong-version') await db.exec("UPDATE approval_requests SET payload=jsonb_set(payload,'{http_action,grant_revision}','1')");
    if (mode === 'wrong-contact') await db.query("UPDATE approval_requests SET payload=jsonb_set(payload,'{contact_id}',to_jsonb($1::text))", [OTHER]);
    if (mode === 'wrong-agent') await db.query("UPDATE approval_requests SET payload=jsonb_set(payload,'{agent_id}',to_jsonb($1::text))", [OTHER]);
    await expect(claim(approved())).rejects.toThrow('http_execution_confirmation_required');
    expect((await db.query('SELECT count(*)::int AS n FROM http_action_runs')).rows).toEqual([{ n: 0 }]);
  });
  it('does not let a second invocation key reuse one human approval', async () => {
    await post(); const run = await claim(approved());
    await db.query('SELECT finish_http_action($1,$2,$3,$4,$5,$6,$7)', [WS, run.id, run.lease_id, 'acknowledged', 200, null, { status: 'received' }]);
    const replay = await claim({ ...approved(), key: 'c'.repeat(64) }); expect(replay).toMatchObject({ claimed: false, id: run.id, state: 'acknowledged' });
    expect((await db.query('SELECT count(*)::int AS n FROM http_action_runs')).rows).toEqual([{ n: 1 }]);
    await expect(claim({ ...approved(), key: 'd'.repeat(64), hash: 'e'.repeat(64) })).rejects.toThrow('http_execution_conflict');
  });
  it('freezes the complete approved customer identity and rejects identity changes or missing snapshots', async () => {
    await post();
    await db.exec("UPDATE contacts SET phone='+19999999999'");
    await expect(claim({ ...approved(), context: { ...context, phone: '+19999999999' } })).rejects.toThrow('http_execution_confirmation_required');
    await db.exec("UPDATE contacts SET phone='+10000000000';UPDATE approval_requests SET payload=payload-'http_action_context'");
    await expect(claim(approved())).rejects.toThrow('http_execution_confirmation_required');
    expect((await db.query('SELECT count(*)::int AS n FROM http_action_runs')).rows).toEqual([{ n: 0 }]);
  });
  it('checks current administrator authority and billing for approved writes', async () => {
    await post(); await db.query('UPDATE approval_requests SET decided_by=$1', [ADMIN]);
    await db.exec("UPDATE workspace_members SET role='agent'"); await expect(claim({ ...approved(), actor: ADMIN })).rejects.toThrow('http_execution_confirmation_required');
    await db.exec("UPDATE workspace_members SET role='admin';UPDATE billing SET allowed=false");
    await expect(claim({ ...approved(), actor: ADMIN })).rejects.toThrow('subscription_read_only');
  });
  it('rejects approval context on GET and denies deleted businesses', async () => {
    await expect(claim({ approval: APPROVAL, actor: OWNER })).rejects.toThrow('invalid_http_execution_context');
    await db.exec('UPDATE workspaces SET deleted_at=now()'); await expect(claim()).rejects.toThrow('invalid_http_execution_context');
  });
  it('denies public RPCs and service writes while allowing private assistant claims', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role}`); await expect(claim()).rejects.toThrow('permission denied'); await db.exec('RESET ROLE');
    }
    await db.exec('SET ROLE service_role'); expect(await claim()).toMatchObject({ claimed: true });
    await expect(db.query("UPDATE http_action_runs SET source_kind='human'")).rejects.toThrow('permission denied'); await db.exec('RESET ROLE');
    await expect(db.query('UPDATE http_action_runs SET source_grant_revision=NULL')).rejects.toThrow('http_action_run_source_check');
  });
});
