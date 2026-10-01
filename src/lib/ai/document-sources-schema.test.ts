import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
const db = new PGlite();
const ws = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const admin = '33333333-3333-4333-8333-333333333333', member = '44444444-4444-4444-8444-444444444444';
const agent = '55555555-5555-4555-8555-555555555555', foreign = '66666666-6666-4666-8666-666666666666';
const migration = readFileSync('supabase/migrations/329_ai_document_sources.sql', 'utf8');
beforeAll(async () => {
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  CREATE TABLE workspaces(id uuid PRIMARY KEY);CREATE TABLE workspace_members(workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,user_id uuid,role text);
  CREATE TABLE ai_agents(id uuid PRIMARY KEY,workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,deleted_at timestamptz);
  CREATE FUNCTION is_workspace_member(ws uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=ws AND user_id=auth.uid()) $$;
  CREATE TABLE billing(allowed boolean);INSERT INTO billing VALUES(true);CREATE FUNCTION workspace_billing_write_allowed(ws uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT allowed FROM public.billing $$;
  GRANT SELECT ON ai_agents TO authenticated;GRANT USAGE ON SCHEMA auth TO authenticated;`);
  await db.exec(migration);
});
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec('RESET ROLE;TRUNCATE workspaces CASCADE;UPDATE billing SET allowed=true');
  await db.query('INSERT INTO workspaces VALUES($1),($2)', [ws, other]);
  await db.query("INSERT INTO workspace_members VALUES($1,$2,'owner'),($1,$3,'agent'),($4,$2,'admin')", [ws, admin, member, other]);
  await db.query('INSERT INTO ai_agents(id,workspace_id) VALUES($1,$2),($3,$4)', [agent, ws, foreign, other]);
});
async function manage(action = 'list', extra: { id?: string;revision?: number;text?: string;actor?: string;workspace?: string;agent?: string;name?: string;sha?: string } = {}) {
  const result = await db.query<{ result: Record<string, unknown> }>('SELECT manage_ai_document_source($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS result',
    [extra.workspace ?? ws, extra.actor ?? admin, extra.agent ?? agent, action, extra.id ?? null, extra.revision ?? null, extra.name ?? 'Policy.docx', extra.text ?? 'Only reviewed business facts.', 'docx', 200, extra.sha ?? 'a'.repeat(64)]);
  return result.rows[0].result;
}
async function active(workspace = ws, id = agent) {
  return (await db.query<{ result: Array<Record<string, unknown>> }>('SELECT active_ai_document_sources($1,$2) AS result', [workspace, id])).rows[0].result;
}
describe('document source SQL authority, versions and withdrawal', () => {
  it('imports as draft and records the exact initial text and author in the same transaction', async () => {
    const row = await manage('create');expect(row).toMatchObject({ status: 'draft', revision: 1 });expect(row).not.toHaveProperty('workspace_id');expect(row).not.toHaveProperty('actor_id');
    expect(await active()).toEqual([]);
    expect((await db.query('SELECT revision,text,status,actor_id FROM ai_document_source_versions')).rows).toEqual([{ revision: 1, text: 'Only reviewed business facts.', status: 'draft', actor_id: admin }]);
  });
  it('requires explicit activation and removes a source from the very next uncached context read on withdrawal', async () => {
    const row = await manage('create'), id = row.id as string;
    await manage('activate', { id, revision: 1 });expect(await active()).toMatchObject([{ id, revision: 2, status: 'active' }]);
    await manage('withdraw', { id, revision: 2 });expect(await active()).toEqual([]);
    expect((await manage('history', { id })).history).toMatchObject([{ revision: 3, status: 'withdrawn' }, { revision: 2, status: 'active' }, { revision: 1, status: 'draft' }]);
  });
  it('editing or replacing withdraws the active text until its new version is activated', async () => {
    const id = (await manage('create')).id as string;await manage('activate', { id, revision: 1 });
    expect(await manage('edit', { id, revision: 2, text: 'Corrected policy' })).toMatchObject({ revision: 3, status: 'draft', text: 'Corrected policy' });expect(await active()).toEqual([]);
    await manage('activate', { id, revision: 3 });expect(await manage('replace', { id, revision: 4, name: 'New-policy.docx', sha: 'b'.repeat(64), text: 'Replacement source' })).toMatchObject({ revision: 5, status: 'draft', name: 'New-policy.docx' });
    expect(await active()).toEqual([]);expect((await db.query('SELECT text FROM ai_document_source_versions WHERE revision=2')).rows).toEqual([{ text: 'Only reviewed business facts.' }]);
  });
  it('does not overwrite another editor and does not silently create repeated identical imports', async () => {
    const initial = await manage('create');expect(await manage('create')).toEqual(initial);
    await manage('edit', { id: initial.id as string, revision: 1, text: 'First editor' });
    await expect(manage('edit', { id: initial.id as string, revision: 1, text: 'Stale editor' })).rejects.toThrow('document_changed');
    expect((await db.query('SELECT revision,text FROM ai_document_sources')).rows).toEqual([{ revision: 2, text: 'First editor' }]);
    expect((await db.query('SELECT count(*)::int AS n FROM ai_document_source_versions')).rows).toEqual([{ n: 2 }]);
  });
  it('rejects foreign business, foreign agent, unknown source and revoked membership for read and write', async () => {
    const id = (await manage('create')).id as string;
    await expect(manage('list', { agent: foreign })).rejects.toThrow('invalid_document_context');
    await expect(manage('activate', { workspace: other, agent: foreign, id, revision: 1 })).rejects.toThrow('invalid_document_context');
    await expect(manage('history', { id: foreign })).rejects.toThrow('invalid_document_context');
    expect(await active(other, agent)).toEqual([]);expect(await active(ws, foreign)).toEqual([]);
    await db.query('DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2', [ws, admin]);
    await expect(manage()).rejects.toThrow('invalid_document_context');await expect(manage('create')).rejects.toThrow('invalid_document_context');
  });
  it('allows current members to inspect but restricts all changes to administrators and writable subscriptions', async () => {
    const row = await manage('create');expect((await manage('list', { actor: member })).sources).toMatchObject([{ id: row.id }]);
    for (const action of ['create','edit','activate','withdraw','replace']) await expect(manage(action, { actor: member, id: row.id as string, revision: 1 })).rejects.toThrow('document_admin_required');
    await db.exec('UPDATE billing SET allowed=false');await expect(manage('activate', { id: row.id as string, revision: 1 })).rejects.toThrow('subscription_read_only');expect((await manage()).sources).toHaveLength(1);
  });
  it('keeps unchanged text and already applied states from creating spurious versions', async () => {
    const id = (await manage('create')).id as string;await manage('edit', { id, revision: 1 });await manage('activate', { id, revision: 1 });await manage('activate', { id, revision: 2 });
    expect((await db.query('SELECT count(*)::int AS n FROM ai_document_source_versions')).rows).toEqual([{ n: 2 }]);
  });
  it('bounds combined active UTF-8 bytes, including emoji, without returning partial documents', async () => {
    const first = await manage('create', { text: 'a'.repeat(30000) });await manage('activate', { id: first.id as string, revision: 1 });
    const second = await manage('create', { name: 'Two.docx', text: '😀'.repeat(5000), sha: 'b'.repeat(64) });
    await expect(manage('activate', { id: second.id as string, revision: 1 })).rejects.toThrow('document_limit');expect(await active()).toHaveLength(1);
    await manage('withdraw', { id: first.id as string, revision: 2 });await manage('activate', { id: second.id as string, revision: 1 });expect(await active()).toHaveLength(1);
  });
  it('enforces active and stored source limits while allowing replacement at capacity', async () => {
    let last = '';
    for (let i = 0; i < 20; i++) { const row = await manage('create', { name: `Policy-${i}.docx` });last = row.id as string;if (i < 10) await manage('activate', { id: last, revision: 1 }); }
    await expect(manage('activate', { id: last, revision: 1 })).rejects.toThrow('document_limit');
    await expect(manage('create', { name: 'Over-limit.docx' })).rejects.toThrow('document_limit');
    expect(await manage('replace', { id: last, revision: 1, text: 'Reused source' })).toMatchObject({ revision: 2, text: 'Reused source' });
  });
  it('hides invalid agent bindings and removed assistants even from the runtime context', async () => {
    const row = await manage('create');await manage('activate', { id: row.id as string, revision: 1 });
    await db.query('UPDATE ai_document_sources SET agent_id=$1,revision=revision+1 WHERE id=$2', [foreign, row.id]);expect(await active()).toEqual([]);
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [admin]);await db.exec('SET ROLE authenticated');expect((await db.query('SELECT * FROM ai_document_sources')).rows).toEqual([]);expect((await db.query('SELECT * FROM ai_document_source_versions')).rows).toHaveLength(2);
    await db.exec('RESET ROLE');await db.query('UPDATE ai_document_sources SET agent_id=$1,revision=revision+1 WHERE id=$2', [agent, row.id]);await db.query('UPDATE ai_agents SET deleted_at=now() WHERE id=$1', [agent]);
    expect(await active()).toEqual([]);await expect(manage()).rejects.toThrow('invalid_document_context');
    await db.exec('SET ROLE authenticated');expect((await db.query('SELECT * FROM ai_document_source_versions')).rows).toEqual([]);
  });
  it('grants no client mutation, service table mutation or public RPC execution; preserves versions on rerun and removes them with the business', async () => {
    await manage('create');await db.exec(migration);
    expect((await db.query("SELECT has_table_privilege('authenticated','ai_document_sources','update') AS client_write,has_table_privilege('service_role','ai_document_source_versions','insert') AS audit_write,has_table_privilege('service_role','ai_document_sources','delete') AS delete_rows,has_function_privilege('anon','manage_ai_document_source(uuid,uuid,uuid,text,uuid,integer,text,text,text,integer,text)','execute') AS public_rpc,has_function_privilege('authenticated','active_ai_document_sources(uuid,uuid)','execute') AS context_rpc")).rows).toEqual([{ client_write: false, audit_write: false, delete_rows: false, public_rpc: false, context_rpc: false }]);
    expect((await db.query('SELECT * FROM ai_document_source_versions')).rows).toHaveLength(1);
    await db.query('DELETE FROM workspaces WHERE id=$1', [ws]);expect((await db.query('SELECT * FROM ai_document_source_versions')).rows).toEqual([]);
  });
});
