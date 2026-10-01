import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
const db = new PGlite();
const ws = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const member = '33333333-3333-4333-8333-333333333333', stranger = '44444444-4444-4444-8444-444444444444';
const id = '55555555-5555-4555-8555-555555555555';
const migration = readFileSync('supabase/migrations/327_return_case_history.sql', 'utf8');
beforeAll(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE workspaces(id uuid PRIMARY KEY);
    CREATE TABLE workspace_members(workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,user_id uuid);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION is_workspace_member(ws uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=ws AND user_id=auth.uid()) $$;
    CREATE TABLE returns(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      status text NOT NULL DEFAULT 'abierta',resolution text,kind text DEFAULT 'devolucion',reason text,customer_note text,photos jsonb DEFAULT '[]',
      order_number text,platform text,decided_by uuid,decided_at timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    ALTER TABLE returns ENABLE ROW LEVEL SECURITY;CREATE POLICY returns_member ON returns FOR ALL USING(is_workspace_member(workspace_id)) WITH CHECK(is_workspace_member(workspace_id));
    GRANT USAGE ON SCHEMA public,auth TO authenticated,service_role,anon;GRANT SELECT,INSERT,UPDATE,DELETE ON returns TO authenticated,service_role;
  `);
  await db.exec(migration); await db.exec(migration);
}, 20000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec("RESET ROLE; TRUNCATE workspaces CASCADE; SELECT set_config('request.jwt.claim.sub','',false);");
  await db.query('INSERT INTO workspaces VALUES($1),($2)', [ws, other]);
  await db.query('INSERT INTO workspace_members VALUES($1,$2)', [ws, member]);
});
const insert = (workspace = ws) => db.query('INSERT INTO returns(id,workspace_id,order_number) VALUES($1,$2,$3)', [id, workspace, '#1001']);
const events = async () => (await db.query<{ event_type: string; actor_id: string | null; snapshot: Record<string, unknown>; previous_snapshot: Record<string, unknown> | null }>('SELECT event_type,actor_id,snapshot,previous_snapshot FROM return_case_events ORDER BY event_sequence')).rows;
describe('transactional return case history', () => {
  it('records opening, approval, reception, changed notes and final resolution with previous values', async () => {
    await insert();
    for (const status of ['aprobada', 'recibida', 'resuelta']) await db.query('UPDATE returns SET status=$1,resolution=$2,decided_by=$3,decided_at=clock_timestamp() WHERE id=$4', [status, `Note ${status}`, member, id]);
    const rows = await events();
    expect(rows.map(row => row.event_type)).toEqual(['opened', 'state_changed', 'state_changed', 'state_changed']);
    expect(rows[0].actor_id).toBeNull(); expect(rows[1].actor_id).toBe(member);
    expect(rows[2].previous_snapshot).toMatchObject({ status: 'aprobada', resolution: 'Note aprobada' });
    expect(rows[3].snapshot).toMatchObject({ status: 'resuelta', resolution: 'Note resuelta' });
  });
  it('does not append a new event for an identical request or timestamp-only update', async () => {
    await insert(); await db.exec("UPDATE returns SET status='abierta',updated_at=clock_timestamp()");
    expect(await events()).toHaveLength(1);
  });
  it('records a note replacement, explicit removal and added evidence without claiming a refund', async () => {
    await insert(); await db.exec("UPDATE returns SET resolution='Reviewed'; UPDATE returns SET resolution=NULL; UPDATE returns SET photos='[\"private-image\"]'");
    const rows = await events();
    expect(rows.map(row => row.event_type)).toEqual(['opened', 'updated', 'updated', 'evidence_changed']);
    expect(rows[2].previous_snapshot).toMatchObject({ resolution: 'Reviewed' }); expect(rows[2].snapshot.resolution).toBeNull();
    expect(rows[3].snapshot.photos).toEqual(['private-image']); expect(rows[3].snapshot).not.toHaveProperty('refund');
  });
  it('rolls back the case change and event together', async () => {
    await insert(); await db.exec("BEGIN; UPDATE returns SET status='recibida'; ROLLBACK;");
    expect(await events()).toHaveLength(1); expect((await db.query('SELECT status FROM returns')).rows).toEqual([{ status: 'abierta' }]);
  });
  it('never attributes a new system update to an unchanged previous decision author', async () => {
    await insert(); await db.query("UPDATE returns SET status='aprobada',decided_by=$1,decided_at=clock_timestamp()", [member]);
    await db.exec("UPDATE returns SET status='recibida'");
    expect((await events()).map(row => row.actor_id)).toEqual([null, member, null]);
  });
  it('prefers the signed database actor over a forged attribution column', async () => {
    await insert(); await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [member]); await db.exec('SET ROLE authenticated');
    await db.query("UPDATE returns SET status='aprobada',decided_by=$1,decided_at=clock_timestamp()", [stranger]);
    expect((await events())[1].actor_id).toBe(member);
  });
  it('keeps case history after case deletion but removes it during business cleanup', async () => {
    await insert(); await db.exec('DELETE FROM returns'); expect(await events()).toHaveLength(1);
    await db.query('DELETE FROM workspaces WHERE id=$1', [ws]); expect(await events()).toHaveLength(0);
  });
  it('captures the existing service writer while denying a direct event rewrite', async () => {
    await db.exec('SET ROLE service_role'); await insert();
    await db.query("UPDATE returns SET status='aprobada',decided_by=$1,decided_at=clock_timestamp()", [member]);
    expect((await events())[1].actor_id).toBe(member);
    await expect(db.exec("UPDATE return_case_events SET event_type='baseline'")).rejects.toThrow('permission denied');
  });
  it('starts imported cases with an observation now and preserves it on a migration retry', async () => {
    await db.exec('ALTER TABLE returns DISABLE TRIGGER returns_case_history'); await insert();
    await db.exec("UPDATE returns SET status='resuelta',created_at='2020-01-01',decided_at='2020-01-02'; ALTER TABLE returns ENABLE TRIGGER returns_case_history");
    await db.exec(migration); const first = (await db.query<{ occurred_at: Date }>('SELECT occurred_at FROM return_case_events')).rows;
    await db.exec(migration);
    expect((await events())[0]).toMatchObject({ event_type: 'baseline', actor_id: null, previous_snapshot: null, snapshot: { status: 'resuelta' } });
    expect(await events()).toHaveLength(1); expect((await db.query('SELECT occurred_at FROM return_case_events')).rows).toEqual(first);
    expect(String(first[0].occurred_at)).not.toContain('2020');
  });
  it('does not carry a previous business snapshot when a privileged process moves a case', async () => {
    await insert(); await db.query('UPDATE returns SET workspace_id=$1,resolution=$2', [other, 'New business note']);
    expect((await events())[1]).toMatchObject({ event_type: 'baseline', previous_snapshot: null });
  });
  it('hides other businesses and stops returning history after membership revocation', async () => {
    await insert(); await db.query('INSERT INTO returns(workspace_id) VALUES($1)', [other]);
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [member]); await db.exec('SET ROLE authenticated');
    expect(await events()).toHaveLength(1);
    await db.exec('RESET ROLE;DELETE FROM workspace_members;SET ROLE authenticated'); expect(await events()).toHaveLength(0);
  });
  it.each(['anon', 'authenticated', 'service_role'])('denies direct history writes by %s', async role => {
    const result = await db.query<{ can_insert: boolean; can_update: boolean; can_delete: boolean; can_execute: boolean; can_reset_sequence: boolean }>(`SELECT has_table_privilege($1,'return_case_events','insert') AS can_insert,
      has_table_privilege($1,'return_case_events','update') AS can_update,has_table_privilege($1,'return_case_events','delete') AS can_delete,
      has_function_privilege($1,'record_return_case_event()','execute') AS can_execute,
      has_sequence_privilege($1,'return_case_events_event_sequence_seq','update') AS can_reset_sequence`, [role]);
    expect(result.rows[0]).toEqual({ can_insert: false, can_update: false, can_delete: false, can_execute: false, can_reset_sequence: false });
  });
});
