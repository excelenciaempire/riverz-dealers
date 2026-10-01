import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
const db = new PGlite();
const WS = '11111111-1111-4111-8111-111111111111', OWNER = '22222222-2222-4222-8222-222222222222';
const MEMBER = '33333333-3333-4333-8333-333333333333', ACTION = '44444444-4444-4444-8444-444444444444';
const AGENT = '55555555-5555-4555-8555-555555555555', OTHER = '66666666-6666-4666-8666-666666666666';
const definition = { method: 'GET', credential_kind: 'none', parameters: [{ key: 'customer', source: 'contact_id', type: 'string', required: true }] };
beforeAll(async () => {
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
    CREATE TABLE workspaces(id uuid PRIMARY KEY,owner_id uuid,deleted_at timestamptz);
    CREATE TABLE workspace_members(workspace_id uuid,user_id uuid,role text,allowed_sections text[]);
    CREATE TABLE ai_agents(id uuid PRIMARY KEY,workspace_id uuid,scope text,is_active boolean,deleted_at timestamptz);
    CREATE TABLE ai_agent_channels(agent_id uuid REFERENCES ai_agents(id) ON DELETE CASCADE,channel text);
    CREATE TABLE billing(allowed boolean);INSERT INTO billing VALUES(true);
    CREATE FUNCTION workspace_billing_write_allowed(ws uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT allowed FROM public.billing $$;`);
  await db.exec(readFileSync('supabase/migrations/330_http_action_configuration.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/332_http_action_assistant_grants.sql', 'utf8'));
});
afterAll(async () => db.close());
beforeEach(async () => {
  await db.exec('RESET ROLE;TRUNCATE workspaces CASCADE;TRUNCATE workspace_members,ai_agents CASCADE;UPDATE billing SET allowed=true');
  await db.query('INSERT INTO workspaces VALUES($1,$2,NULL)', [WS, OWNER]);
  await db.query("INSERT INTO workspace_members VALUES($1,$2,'admin',NULL)", [WS, MEMBER]);
  await db.query("INSERT INTO ai_agents VALUES($1,$2,'workspace',true,NULL)", [AGENT, WS]);
  await db.query("INSERT INTO http_actions(id,workspace_id,definition,state,revision,actor_id) VALUES($1,$2,$3,'active',2,$4)", [ACTION, WS, definition, OWNER]);
});
async function grant(operation = 'save', opts: { ws?: string; actor?: string; agent?: string; action?: string; channel?: string; scope?: string; actionRevision?: number; revision?: number } = {}) {
  return (await db.query<{ result: Record<string, unknown> }>('SELECT manage_http_action_assistant_grant($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result',
    [opts.ws ?? WS, opts.actor ?? OWNER, opts.action ?? ACTION, operation, opts.agent ?? AGENT, opts.channel ?? 'whatsapp',
      opts.scope ?? 'contact', opts.actionRevision ?? 2, opts.revision ?? 0])).rows[0].result;
}
describe('explicit HTTP assistant delegation SQL', () => {
  it('starts with no grants and stores an exact action version, assistant and channel', async () => {
    expect(await grant('list')).toEqual({ grants: [] });
    expect(await grant()).toMatchObject({ agent_id: AGENT, channel: 'whatsapp', context_scope: 'contact', action_revision: 2, revision: 1, state: 'active', granted_by: OWNER });
    expect((await db.query('SELECT revision,action_revision,state FROM http_action_assistant_grant_versions')).rows).toEqual([{ revision: 1, action_revision: 2, state: 'active' }]);
  });
  it('allows the current owner and denies removed, non-admin or section-restricted members', async () => {
    await grant('save', { actor: MEMBER });
    await db.query('DELETE FROM workspace_members WHERE user_id=$1', [MEMBER]);
    await expect(grant('list', { actor: MEMBER })).rejects.toThrow('http_grant_admin_required');
    await db.query("INSERT INTO workspace_members VALUES($1,$2,'agent',NULL)", [WS, MEMBER]);
    await expect(grant('save', { actor: MEMBER, revision: 1 })).rejects.toThrow('http_grant_admin_required');
    await db.query("UPDATE workspace_members SET role='admin',allowed_sections=ARRAY['/ajustes']");
    await expect(grant('list', { actor: MEMBER })).rejects.toThrow('http_grant_admin_required');
    await db.exec("UPDATE workspace_members SET allowed_sections=ARRAY['/ajustes','/automatizaciones']");
    expect((await grant('list', { actor: MEMBER })).grants).toHaveLength(1);
  });
  it('rejects foreign/deleted businesses, foreign assistants and foreign actions', async () => {
    await expect(grant('save', { ws: OTHER })).rejects.toThrow('invalid_http_grant_context');
    await expect(grant('save', { action: OTHER })).rejects.toThrow('invalid_http_grant_context');
    await db.query('UPDATE ai_agents SET workspace_id=$1', [OTHER]);
    await expect(grant()).rejects.toThrow('invalid_http_grant_context');
    await db.query('UPDATE ai_agents SET workspace_id=$1,deleted_at=now()', [WS]);
    await expect(grant()).rejects.toThrow('invalid_http_grant_context');
    await db.exec('UPDATE workspaces SET deleted_at=now()');
    await expect(grant('list')).rejects.toThrow('invalid_http_grant_context');
  });
  it('requires channel coverage and does not invent wildcard channels', async () => {
    await db.exec("UPDATE ai_agents SET scope='channels'");
    await expect(grant()).rejects.toThrow('http_grant_invalid');
    await db.query("INSERT INTO ai_agent_channels VALUES($1,'whatsapp')", [AGENT]);
    expect(await grant()).toMatchObject({ state: 'active' });
    await expect(grant('save', { channel: 'any' })).rejects.toThrow('http_grant_invalid');
  });
  it('does not delegate a customer lookup without a required trusted identity binding', async () => {
    await db.query('UPDATE http_actions SET definition=$1,revision=3', [{ ...definition, parameters: [{ key: 'customer', source: 'input', type: 'string', required: true }] }]);
    await expect(grant('save', { actionRevision: 3 })).rejects.toThrow('http_grant_identity_required');
    await db.query('UPDATE http_actions SET definition=$1,revision=4', [{ ...definition, parameters: [{ key: 'conversation', source: 'conversation_id', type: 'string', required: true }] }]);
    await expect(grant('save', { actionRevision: 4 })).rejects.toThrow('http_grant_identity_required');
  });
  it('restricts business-wide context to GET without free inputs', async () => {
    await db.query('UPDATE http_actions SET definition=$1,revision=3', [{ ...definition, parameters: [] }]);
    expect(await grant('save', { scope: 'business', actionRevision: 3 })).toMatchObject({ context_scope: 'business' });
    await db.query('UPDATE http_actions SET definition=$1,revision=4', [{ ...definition, parameters: [], method: 'POST' }]);
    await expect(grant('save', { scope: 'business', actionRevision: 4, revision: 1 })).rejects.toThrow('http_grant_identity_required');
    await db.query('UPDATE http_actions SET definition=$1,revision=5', [{ ...definition, parameters: [{ key: 'query', type: 'string', required: false }] }]);
    await expect(grant('save', { scope: 'business', actionRevision: 5, revision: 1 })).rejects.toThrow('http_grant_identity_required');
  });
  it('uses version checks for edits and explicit withdrawal and supports withdrawal after action changes', async () => {
    await grant(); await expect(grant()).rejects.toThrow('http_grant_changed');
    await expect(grant('save', { revision: 1, actionRevision: 1 })).rejects.toThrow('http_grant_changed');
    await db.exec("UPDATE http_actions SET revision=3,state='draft'");
    expect(await grant('withdraw', { revision: 1 })).toMatchObject({ state: 'withdrawn', revision: 2 });
    expect(await grant('withdraw', { revision: 2 })).toMatchObject({ state: 'withdrawn', revision: 2 });
    expect((await db.query('SELECT count(*)::int AS n FROM http_action_assistant_grant_versions')).rows).toEqual([{ n: 2 }]);
    expect(await grant('save', { revision: 2, actionRevision: 3 })).toMatchObject({ revision: 3, action_revision: 3 });
  });
  it('keeps read-only inspection and blocks subscription mutations', async () => {
    await grant(); await db.exec('UPDATE billing SET allowed=false');
    expect((await grant('list')).grants).toHaveLength(1);
    for (const operation of ['save', 'withdraw']) await expect(grant(operation, { revision: 1 })).rejects.toThrow('subscription_read_only');
  });
  it('does not activate a paused assistant or a draft action when storing an allowance', async () => {
    await db.exec("UPDATE ai_agents SET is_active=false;UPDATE http_actions SET state='draft',revision=3");
    expect(await grant('save', { actionRevision: 3 })).toMatchObject({ state: 'active', action_revision: 3 });
    expect((await db.query('SELECT is_active FROM ai_agents')).rows).toEqual([{ is_active: false }]);
    expect((await db.query('SELECT state FROM http_actions')).rows).toEqual([{ state: 'draft' }]);
  });
  it('bounds enabled actions to twelve per assistant/channel', async () => {
    await grant();
    for (let n = 1; n < 12; n++) {
      const action = `77777777-7777-4777-8777-${String(n).padStart(12, '0')}`;
      await db.query("INSERT INTO http_actions(id,workspace_id,definition,state,revision,actor_id) VALUES($1,$2,$3,'active',2,$4)", [action, WS, definition, OWNER]);
      await grant('save', { action });
    }
    await db.query("INSERT INTO http_actions(id,workspace_id,definition,state,revision,actor_id) VALUES($1,$2,$3,'active',2,$4)", [OTHER, WS, definition, OWNER]);
    await expect(grant('save', { action: OTHER })).rejects.toThrow('http_grant_limit');
    await grant('withdraw', { revision: 1 });
    expect(await grant('save', { action: OTHER })).toMatchObject({ state: 'active' });
  });
  it('rolls back a permission change if its history cannot be confirmed', async () => {
    await grant();
    await db.exec("CREATE FUNCTION fail_grant_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit-unavailable';END $$;CREATE TRIGGER fail_grant_history BEFORE INSERT ON http_action_assistant_grant_versions FOR EACH ROW EXECUTE FUNCTION fail_grant_history();");
    try { await expect(grant('withdraw', { revision: 1 })).rejects.toThrow('audit-unavailable'); }
    finally { await db.exec('DROP TRIGGER fail_grant_history ON http_action_assistant_grant_versions;DROP FUNCTION fail_grant_history()'); }
    expect((await grant('list')).grants).toMatchObject([{ state: 'active', revision: 1 }]);
  });
  it('keeps the complete per-action catalog within its hundred-row bound', async () => {
    await grant();
    for (let n = 1; n < 100; n++) {
      const agent = `88888888-8888-4888-8888-${String(n).padStart(12, '0')}`;
      await db.query("INSERT INTO ai_agents VALUES($1,$2,'workspace',true,NULL)", [agent, WS]);
      await grant('save', { agent });
    }
    expect((await grant('list')).grants).toHaveLength(100);
    await db.query("INSERT INTO ai_agents VALUES($1,$2,'workspace',true,NULL)", [OTHER, WS]);
    await expect(grant('save', { agent: OTHER })).rejects.toThrow('http_grant_limit');
    expect(await grant('save', { revision: 1 })).toMatchObject({ revision: 2 });
  });
  it('denies public calls and direct service writes', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role}`); await expect(grant('list')).rejects.toThrow('permission denied');
      await expect(db.query('SELECT * FROM http_action_assistant_grants')).rejects.toThrow('permission denied'); await db.exec('RESET ROLE');
    }
    await db.exec('SET ROLE service_role'); expect(await grant()).toMatchObject({ revision: 1 });
    await expect(db.query("UPDATE http_action_assistant_grants SET state='withdrawn'")).rejects.toThrow('permission denied');
    await expect(db.query('DELETE FROM http_action_assistant_grant_versions')).rejects.toThrow('permission denied'); await db.exec('RESET ROLE');
  });
});
