import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
const db = new PGlite();
const WS = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
const OWNER = '33333333-3333-4333-8333-333333333333', ADMIN = '44444444-4444-4444-8444-444444444444';
const MEMBER = '55555555-5555-4555-8555-555555555555', ID = '66666666-6666-4666-8666-666666666666';
const sealed = `${'a'.repeat(24)}:${'b'.repeat(80)}:${'c'.repeat(32)}`;
const definition = { name: 'Configured status', description: 'Status lookup', method: 'GET', url: 'https://integration.test/query', credential_kind: 'bearer', parameters: [], outputs: [] };
beforeAll(async () => {
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
    CREATE TABLE workspaces(id uuid PRIMARY KEY,owner_id uuid,deleted_at timestamptz);
    CREATE TABLE workspace_members(workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,user_id uuid,role text,allowed_sections text[]);
    CREATE TABLE billing(allowed boolean);INSERT INTO billing VALUES(true);
    CREATE FUNCTION workspace_billing_write_allowed(ws uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT allowed FROM public.billing $$;`);
  await db.exec(readFileSync('supabase/migrations/330_http_action_configuration.sql', 'utf8'));
});
afterAll(async () => db.close());
beforeEach(async () => {
  await db.exec('RESET ROLE;TRUNCATE workspaces CASCADE;UPDATE billing SET allowed=true');
  await db.query('INSERT INTO workspaces(id,owner_id) VALUES($1,$2),($3,$4)', [WS, OWNER, OTHER, MEMBER]);
  await db.query("INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'admin'),($1,$3,'agent'),($4,$3,'admin')", [WS, ADMIN, MEMBER, OTHER]);
});
async function manage(operation = 'list', options: { ws?: string; actor?: string; id?: string; revision?: number;
  def?: Record<string, unknown>; ciphertext?: string | null; replace?: boolean } = {}) {
  const result = await db.query<{ result: Record<string, unknown> }>('SELECT manage_http_action($1,$2,$3,$4,$5,$6,$7,$8) AS result',
    [options.ws ?? WS, options.actor ?? OWNER, operation, options.id ?? ID, options.revision ?? 0,
      options.def ?? definition, options.ciphertext === undefined ? sealed : options.ciphertext, options.replace ?? false]);
  return result.rows[0].result;
}
describe('HTTP configuration SQL authority and version audit', () => {
  it('creates a draft and confirms its version transactionally without returning the ciphertext', async () => {
    const row = await manage('create'); expect(row).toMatchObject({ id: ID, state: 'draft', revision: 1, has_secret: true });
    expect(JSON.stringify(row)).not.toContain(sealed); expect(row).not.toHaveProperty('workspace_id'); expect(row).not.toHaveProperty('actor_id');
    const history = await manage('history'); expect(history).toMatchObject({ history: [{ revision: 1, state: 'draft', credential_present: true }] });
    expect(JSON.stringify(history)).not.toContain(sealed);
    expect((await db.query('SELECT credential_ciphertext FROM http_actions')).rows).toEqual([{ credential_ciphertext: sealed }]);
  });
  it('requires explicit activation and withdraws edits until reviewed again', async () => {
    await manage('create'); expect(await manage('activate', { revision: 1 })).toMatchObject({ state: 'active', revision: 2 });
    expect(await manage('save', { revision: 2, def: { ...definition, description: 'New reviewed description' } })).toMatchObject({ state: 'draft', revision: 3 });
    await manage('activate', { revision: 3 }); expect(await manage('withdraw', { revision: 4 })).toMatchObject({ state: 'withdrawn', revision: 5 });
    expect((await manage('history')).history).toMatchObject([{ revision: 5 }, { revision: 4 }, { revision: 3 }, { revision: 2 }, { revision: 1 }]);
  });
  it('rejects stale editors and preserves credentials unless explicitly replaced', async () => {
    await manage('create'); await manage('save', { revision: 1, ciphertext: 'caller-ignored' });
    await expect(manage('activate', { revision: 1 })).rejects.toThrow('http_action_changed');
    expect((await db.query('SELECT credential_ciphertext,revision FROM http_actions')).rows).toEqual([{ credential_ciphertext: sealed, revision: 2 }]);
    const next = `${'d'.repeat(24)}:${'e'.repeat(40)}:${'f'.repeat(32)}`;
    await manage('save', { revision: 2, replace: true, ciphertext: next });
    expect((await db.query('SELECT credential_ciphertext FROM http_actions')).rows).toEqual([{ credential_ciphertext: next }]);
    expect(JSON.stringify(await manage('history'))).not.toContain(next);
  });
  it('uses the current owner without relying on a duplicated owner membership record', async () => {
    expect(await manage('create')).toMatchObject({ id: ID });
    await db.query('UPDATE workspaces SET owner_id=$1 WHERE id=$2', [MEMBER, WS]);
    await expect(manage('list')).rejects.toThrow('http_action_admin_required');
    expect((await manage('list', { actor: MEMBER })).actions).toHaveLength(1);
  });
  it('denies agents, missing users and revoked administrators for every operation', async () => {
    await manage('create');
    for (const operation of ['list', 'history', 'create', 'save', 'activate', 'withdraw']) {
      await expect(manage(operation, { actor: MEMBER, revision: 1 })).rejects.toThrow('http_action_admin_required');
    }
    expect((await manage('list', { actor: ADMIN })).actions).toHaveLength(1);
    await db.query('DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2', [WS, ADMIN]);
    await expect(manage('list', { actor: ADMIN })).rejects.toThrow('http_action_admin_required');
  });
  it('applies current settings section restrictions, including empty or unknown roles', async () => {
    await manage('create');
    await db.query("UPDATE workspace_members SET allowed_sections=ARRAY['/bandeja'] WHERE user_id=$1", [ADMIN]);
    await expect(manage('list', { actor: ADMIN })).rejects.toThrow('http_action_admin_required');
    await db.query("UPDATE workspace_members SET allowed_sections=ARRAY['/ajustes'] WHERE user_id=$1", [ADMIN]);
    expect((await manage('list', { actor: ADMIN })).actions).toHaveLength(1);
    await db.query('UPDATE workspace_members SET role=NULL WHERE user_id=$1', [ADMIN]);
    await expect(manage('list', { actor: ADMIN })).rejects.toThrow('http_action_admin_required');
  });
  it('keeps deleted or foreign businesses and foreign action IDs out of reads and writes', async () => {
    await manage('create');
    expect((await manage('list', { ws: OTHER, actor: MEMBER })).actions).toEqual([]);
    await expect(manage('history', { ws: OTHER, actor: MEMBER })).rejects.toThrow('invalid_http_action_context');
    await expect(manage('save', { ws: OTHER, actor: MEMBER, revision: 1 })).rejects.toThrow('invalid_http_action_context');
    await db.query('UPDATE workspaces SET deleted_at=now() WHERE id=$1', [WS]);
    await expect(manage()).rejects.toThrow('invalid_http_action_context');
  });
  it('allows read-only subscription inspection and blocks every mutation', async () => {
    await manage('create'); await db.exec('UPDATE billing SET allowed=false');
    expect((await manage()).actions).toHaveLength(1); expect((await manage('history')).history).toHaveLength(1);
    for (const operation of ['create', 'save', 'activate', 'withdraw']) await expect(manage(operation, { revision: 1 })).rejects.toThrow('subscription_read_only');
    expect((await db.query('SELECT count(*)::int AS n FROM http_action_versions')).rows).toEqual([{ n: 1 }]);
  });
  it('clears a credential when switching to no authentication and rejects missing or plaintext secrets', async () => {
    await expect(manage('create', { ciphertext: 'plaintext-secret' })).rejects.toThrow('http_action_credential_required');
    await expect(manage('create', { ciphertext: null })).rejects.toThrow('http_action_credential_required');
    await manage('create');
    expect(await manage('save', { revision: 1, def: { ...definition, credential_kind: 'none' } })).toMatchObject({ has_secret: false });
    expect((await db.query('SELECT credential_ciphertext FROM http_actions')).rows).toEqual([{ credential_ciphertext: null }]);
  });
  it('does not create extra history for repeated activation or withdrawal', async () => {
    await manage('create'); await manage('activate', { revision: 1 }); await manage('activate', { revision: 2 });
    await manage('withdraw', { revision: 2 }); await manage('withdraw', { revision: 3 });
    expect((await db.query('SELECT count(*)::int AS n FROM http_action_versions')).rows).toEqual([{ n: 3 }]);
  });
  it('bounds stored actions and still lets existing actions be edited at capacity', async () => {
    await manage('create');
    for (let i = 1; i < 20; i++) await manage('create', { id: `77777777-7777-4777-8777-${String(i).padStart(12, '0')}` });
    await expect(manage('create', { id: '88888888-8888-4888-8888-888888888888' })).rejects.toThrow('http_action_limit');
    expect(await manage('save', { revision: 1 })).toMatchObject({ revision: 2 });
  });
  it('rolls back the configuration change if the audit insertion cannot complete', async () => {
    await manage('create');
    await db.exec("CREATE FUNCTION fail_http_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit-unavailable';END $$;CREATE TRIGGER fail_audit BEFORE INSERT ON http_action_versions FOR EACH ROW EXECUTE FUNCTION fail_http_audit();");
    try { await expect(manage('save', { revision: 1 })).rejects.toThrow('audit-unavailable'); }
    finally { await db.exec('DROP TRIGGER fail_audit ON http_action_versions;DROP FUNCTION fail_http_audit()'); }
    expect((await db.query('SELECT revision FROM http_actions')).rows).toEqual([{ revision: 1 }]);
  });
  it('exposes neither table nor RPC to anonymous/authenticated callers and denies service direct writes', async () => {
    await manage('create');
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      await expect(db.query('SELECT * FROM http_actions')).rejects.toThrow('permission denied');
      await expect(manage()).rejects.toThrow('permission denied'); await db.exec('RESET ROLE');
    }
    await db.exec('SET ROLE service_role');
    expect((await manage()).actions).toHaveLength(1);
    await expect(db.query("UPDATE http_actions SET state='active'")).rejects.toThrow('permission denied');
    await expect(db.query('DELETE FROM http_action_versions')).rejects.toThrow('permission denied'); await db.exec('RESET ROLE');
  });
});
