import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
const db = new PGlite();
const ws = '11111111-1111-4111-8111-111111111111', admin = '22222222-2222-4222-8222-222222222222',
  agent = '33333333-3333-4333-8333-333333333333', other = '44444444-4444-4444-8444-444444444444';
const state = 'a'.repeat(64), cookie = 'b'.repeat(64), file = 'abcdefghijklmnop';
const doc = { name: 'Policy.docx', text: 'Reviewed business facts', format: 'docx', bytes: 200, sha256: 'c'.repeat(64) };
beforeAll(async () => {
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT NULL::uuid$$;
    CREATE TABLE workspaces(id uuid PRIMARY KEY,deleted_at timestamptz);
    CREATE TABLE workspace_members(workspace_id uuid,user_id uuid,role text,allowed_sections text[]);
    CREATE TABLE ai_agents(id uuid PRIMARY KEY,workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,deleted_at timestamptz);
    CREATE FUNCTION is_workspace_member(ws uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
    CREATE TABLE billing(allowed boolean);INSERT INTO billing VALUES(true);
    CREATE FUNCTION workspace_billing_write_allowed(ws uuid) RETURNS boolean LANGUAGE sql AS $$SELECT allowed FROM public.billing$$;`);
  for (const name of ['329_ai_document_sources.sql', '345_ai_drive_sync.sql']) await db.exec(readFileSync('supabase/migrations/' + name, 'utf8'));
}, 30_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec('RESET ROLE;TRUNCATE workspaces CASCADE;TRUNCATE workspace_members;UPDATE billing SET allowed=true');
  await db.query('INSERT INTO workspaces VALUES($1,NULL)', [ws]);
  await db.query("INSERT INTO workspace_members VALUES($1,$2,'admin',NULL)", [ws, admin]);
  await db.query('INSERT INTO ai_agents VALUES($1,$2,NULL)', [agent, ws]);
});
const scalar = async (sql: string, args: unknown[] = []) => Object.values((await db.query<Record<string, unknown>>(sql, args)).rows[0])[0];
async function connect(account = 'google-account') {
  await scalar('SELECT start_ai_drive_oauth($1,$2,$3,$4,$5,$6)', [ws, admin, agent, state, cookie, 'encrypted-verifier']);
  await scalar('SELECT consume_ai_drive_oauth($1,$2,$3)', [admin, state, cookie]);
  return scalar('SELECT connect_ai_drive($1,$2,$3,$4,$5)', [admin, state, account, 'owner@example.com', 'encrypted-credential']);
}
const manage = (action: string, extra: { id?: string; revision?: number; file?: string; actor?: string; workspace?: string; agent?: string } = {}) =>
  scalar('SELECT manage_ai_drive_source($1,$2,$3,$4,$5,$6,$7)', [extra.workspace ?? ws, extra.actor ?? admin, extra.agent ?? agent, action, extra.file ?? file, extra.id ?? null, extra.revision ?? null]);
type Job = { id: string; lease_id: string; connection_revision: number; credential_ciphertext: string; source_id: string | null };
const claim = () => scalar('SELECT claim_ai_drive_sources(6)') as Promise<Job[]>;
const finish = (job: Job, document: unknown = doc, remote = '1') => scalar('SELECT finish_ai_drive_source($1,$2,$3,$4,$5,$6)', [job.id, job.lease_id, job.connection_revision, document, remote, '2026-10-01T00:00:00Z']);
const active = () => scalar('SELECT active_ai_document_sources($1,$2)', [ws, agent]);
async function imported() { await connect(); await manage('add'); const job = (await claim())[0]; await finish(job); return { ...job, source_id: await scalar('SELECT source_id FROM ai_drive_sources') as string }; }
const sourceAction = (action: string, id: string, revision: number, text: string | null = null) => scalar('SELECT manage_ai_document_source($1,$2,$3,$4,$5,$6,NULL,$7)', [ws, admin, agent, action, id, revision, text]);
const due = () => db.exec("UPDATE ai_drive_sources SET next_sync_at=clock_timestamp()-interval '1 second'");
describe('Drive scoped consent, durable read jobs and reviewed document versions', () => {
  it('is private by metadata and rejects direct authenticated access', async () => {
    expect(await scalar('SELECT ai_drive_sync_ready()')).toBe(true); await db.exec('SET ROLE authenticated');
    await expect(db.exec('SELECT * FROM ai_drive_connections')).rejects.toThrow('permission denied');
    await expect(db.exec('SELECT claim_ai_drive_sources(6)')).rejects.toThrow('permission denied');
    await expect(db.exec('SELECT ai_drive_sync_ready()')).rejects.toThrow('permission denied'); await db.exec('RESET ROLE');
  });
  it('keeps OAuth bound to browser, authenticated actor and one-time state', async () => {
    await scalar('SELECT start_ai_drive_oauth($1,$2,$3,$4,$5,$6)', [ws, admin, agent, state, cookie, 'encrypted-verifier']);
    await expect(scalar('SELECT consume_ai_drive_oauth($1,$2,$3)', [other, state, cookie])).rejects.toThrow('invalid_document_context');
    await expect(scalar('SELECT consume_ai_drive_oauth($1,$2,$3)', [admin, state, state])).rejects.toThrow('invalid_document_context');
    expect(await scalar('SELECT consume_ai_drive_oauth($1,$2,$3)', [admin, state, cookie])).toMatchObject({ workspace_id: ws, agent_id: agent, verifier_ciphertext: 'encrypted-verifier' });
    await expect(scalar('SELECT consume_ai_drive_oauth($1,$2,$3)', [admin, state, cookie])).rejects.toThrow('invalid_document_context');
  });
  it('does not connect before consuming a valid current consent', async () => {
    await expect(scalar('SELECT connect_ai_drive($1,$2,$3,$4,$5)', [admin, state, 'account', 'owner@example.com', 'encrypted-credential'])).rejects.toThrow('invalid_document_context');
    expect(await scalar('SELECT count(*) FROM ai_drive_connections')).toBe(0);
  });
  it.each(['expired', 'removed_member', 'wrong_section', 'read_only'])('rejects %s consent', async kind => {
    await scalar('SELECT start_ai_drive_oauth($1,$2,$3,$4,$5,$6)', [ws, admin, agent, state, cookie, 'encrypted-verifier']);
    if (kind === 'expired') await db.exec("UPDATE ai_drive_oauth SET expires_at=clock_timestamp()-interval '1 second'");
    if (kind === 'removed_member') await db.exec('DELETE FROM workspace_members');
    if (kind === 'wrong_section') await db.exec("UPDATE workspace_members SET allowed_sections=ARRAY['/pedidos']");
    if (kind === 'read_only') await db.exec('UPDATE billing SET allowed=false');
    await expect(scalar('SELECT consume_ai_drive_oauth($1,$2,$3)', [admin, state, cookie])).rejects.toThrow();
  });
  it('never lists credentials and prepares selected files without importing or activating', async () => {
    expect(await manage('list')).toEqual({ connected: false, email: null, sources: [] }); await connect();
    const added = await manage('add'); expect(await manage('add')).toMatchObject({ ...added as object, replayed: true });
    const list = await manage('list'); expect(JSON.stringify(list)).not.toContain('encrypted');
    expect(list).toMatchObject({ connected: true, email: 'owner@example.com', sources: [{ file_id: file, state: 'queued' }] });
    expect(await scalar('SELECT count(*) FROM ai_document_sources')).toBe(0); expect(await active()).toEqual([]);
  });
  it('claims once and imports as an explicitly reviewed draft', async () => {
    await connect(); await manage('add'); const job = (await claim())[0]; expect(await claim()).toEqual([]);
    expect(await finish(job)).toBe(true); expect(await finish(job)).toBe(false);
    expect(await scalar('SELECT status FROM ai_document_sources')).toBe('draft'); expect(await active()).toEqual([]);
    const id = await scalar('SELECT source_id FROM ai_drive_sources') as string;
    await sourceAction('activate', id, 1); expect(await active()).toMatchObject([{ id, status: 'active' }]);
  });
  it('preserves a reviewed local edit until the provider revision changes', async () => {
    const job = await imported(); await sourceAction('edit', job.source_id!, 1, 'Local correction'); await sourceAction('activate', job.source_id!, 2);
    await due(); expect(await finish((await claim())[0])).toBe(true); expect(await active()).toMatchObject([{ text: 'Local correction', revision: 3 }]);
    await due(); await finish((await claim())[0], { ...doc, sha256: 'd'.repeat(64), text: 'Changed remote policy' }, '2');
    expect(await active()).toEqual([]); expect(await scalar('SELECT status FROM ai_document_sources')).toBe('draft');
    expect(await scalar('SELECT count(*) FROM ai_document_source_versions')).toBe(4);
  });
  it('rejects an edit made after claiming instead of overwriting it', async () => {
    const job = await imported(); await due(); const next = (await claim())[0]; await sourceAction('edit', job.source_id!, 1, 'Human edit while processing');
    await expect(finish(next, { ...doc, text: 'Changed remote', sha256: 'd'.repeat(64) }, '2')).rejects.toThrow('document_changed');
    expect(await scalar('SELECT text FROM ai_document_sources')).toBe('Human edit while processing');
  });
  it.each(['role','section','billing'])('checks current %s before accepting an unchanged provider version', async kind => {
    const job = await imported(); await sourceAction('activate', job.source_id!, 1); await due(); const next = (await claim())[0];
    if (kind === 'role') await db.exec("UPDATE workspace_members SET role='agent'");
    if (kind === 'section') await db.exec("UPDATE workspace_members SET allowed_sections=ARRAY['/pedidos']");
    if (kind === 'billing') { await db.exec('UPDATE billing SET allowed=false'); await expect(finish(next)).rejects.toThrow('subscription_read_only'); }
    else expect(await finish(next)).toBe(false);
    expect(await scalar('SELECT state FROM ai_drive_sources')).toBe('processing');
  });
  it('does not replace reviewed text when a new export version changes only binary metadata', async () => {
    const job = await imported(); await sourceAction('activate', job.source_id!, 1); await due();
    expect(await finish((await claim())[0], { ...doc, sha256: 'd'.repeat(64), bytes: 250 }, '2')).toBe(true);
    expect(await active()).toMatchObject([{ text: doc.text, revision: 2, status: 'active' }]);
    expect(await scalar('SELECT count(*) FROM ai_document_source_versions')).toBe(2);
  });
  it('withdraws denied content immediately and records a system withdrawal', async () => {
    const job = await imported(); await sourceAction('activate', job.source_id!, 1); await due(); const next = (await claim())[0];
    expect(await scalar('SELECT fail_ai_drive_source($1,$2,$3)', [next.id, next.lease_id, 'drive_denied'])).toBe(true);
    expect(await active()).toEqual([]); expect(await scalar('SELECT status FROM ai_document_sources')).toBe('withdrawn');
    expect(await scalar('SELECT actor_id FROM ai_document_source_versions ORDER BY revision DESC LIMIT 1')).toBeNull();
  });
  it('excludes stale or failed permissions even while the source itself remains active', async () => {
    const job = await imported(); await sourceAction('activate', job.source_id!, 1); await db.exec("UPDATE ai_drive_sources SET verified_until=clock_timestamp()-interval '1 second'");
    expect(await active()).toEqual([]); await db.exec("UPDATE ai_drive_sources SET verified_until=clock_timestamp()+interval '20 minutes'");
    await db.exec('DELETE FROM workspace_members'); expect(await active()).toEqual([]); expect(await claim()).toEqual([]);
  });
  it('disconnects all selected files, removes credentials and keeps unrelated local sources', async () => {
    const job = await imported(); await sourceAction('activate', job.source_id!, 1);
    await scalar('SELECT manage_ai_document_source($1,$2,$3,$4,NULL,NULL,$5,$6,$7,$8,$9)', [ws, admin, agent, 'create', 'Local.docx', 'Local facts', 'docx', 100, 'e'.repeat(64)]);
    await manage('disconnect'); expect(await active()).toEqual([]); expect(await scalar('SELECT credential_ciphertext FROM ai_drive_connections')).toBeNull();
    expect(await scalar("SELECT status FROM ai_document_sources WHERE name='Local.docx'")).toBe('draft');
    expect(await scalar("SELECT state FROM ai_drive_sources")).toBe('removed');
  });
  it('does not adopt a preexisting local draft through import deduplication', async () => {
    await scalar('SELECT manage_ai_document_source($1,$2,$3,$4,NULL,NULL,$5,$6,$7,$8,$9)', [ws, admin, agent, 'create', doc.name, doc.text, doc.format, doc.bytes, doc.sha256]);
    await connect(); await manage('add'); await expect(finish((await claim())[0])).rejects.toThrow('document_changed');
    expect(await scalar('SELECT source_id FROM ai_drive_sources')).toBeNull();
  });
  it('reclaims an interrupted read job with a new lease and rejects the old finisher', async () => {
    await connect(); await manage('add'); const old = (await claim())[0];
    await db.exec("UPDATE ai_drive_sources SET lease_until=clock_timestamp()-interval '1 second'"); const fresh = (await claim())[0];
    expect(fresh.lease_id).not.toBe(old.lease_id); expect(await finish(old)).toBe(false); expect(await finish(fresh)).toBe(true);
  });
  it('uses credential CAS and refuses stale rotations or deleted leases', async () => {
    await connect(); await manage('add'); const job = (await claim())[0];
    const rotate = (prior = 'encrypted-credential') => scalar('SELECT update_ai_drive_credentials($1,$2,$3,$4,$5)', [job.id, job.lease_id, job.connection_revision, prior, 'encrypted-new-credential']);
    expect(await rotate()).toBe(true); expect(await rotate()).toBe(false);
    await manage('remove', { id: job.id, revision: 1 }); expect(await rotate('encrypted-new-credential')).toBe(false); expect(await finish(job)).toBe(false);
  });
  it('requires selection and review again after changing the Google account', async () => {
    const job = await imported(); await sourceAction('activate', job.source_id!, 1); await connect('different-google-account');
    expect(await active()).toEqual([]); expect(await scalar('SELECT state FROM ai_drive_sources')).toBe('removed'); expect(await claim()).toEqual([]);
  });
  it.each(['foreign_workspace', 'foreign_agent', 'ordinary_member'])('blocks %s source management', async kind => {
    if (kind === 'ordinary_member') await db.exec("UPDATE workspace_members SET role='agent'");
    await expect(manage('add', { workspace: kind === 'foreign_workspace' ? other : ws, agent: kind === 'foreign_agent' ? other : agent })).rejects.toThrow('document_admin_required');
  });
});
