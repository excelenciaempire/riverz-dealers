import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
const db = new PGlite();
const workspace = '11111111-1111-4111-8111-111111111111', actor = '22222222-2222-4222-8222-222222222222';
const id = '33333333-3333-4333-8333-333333333333', other = '44444444-4444-4444-8444-444444444444';
const payload = { tool: 'http_action_example_v1', input: { request: 'reviewed' }, dedupe_key: 'http:' + 'a'.repeat(64) };
const migration = readFileSync('supabase/migrations/339_http_approval_review_snapshot.sql', 'utf8');
beforeAll(async () => {
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
    CREATE TABLE approval_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid,kind text,title text,body text,payload jsonb,
    contact_id uuid,status text DEFAULT 'pendiente',expires_at timestamptz DEFAULT clock_timestamp()+interval '3 days',created_at timestamptz DEFAULT clock_timestamp(),
    decided_by uuid,decided_at timestamptz,decided_via text,notified_phone text,notified_message_id text,result text,execution_result jsonb);
    GRANT SELECT,INSERT,UPDATE ON approval_requests TO authenticated,service_role;`);
  await db.exec(migration);
  await db.exec(readFileSync('supabase/migrations/340_http_approval_review_guard.sql', 'utf8'));
}, 30000);
afterAll(async () => db.close());
beforeEach(async () => { await db.exec('RESET ROLE;TRUNCATE approval_requests'); });
const insert = (p: unknown = payload, ws = workspace, kind = 'herramienta', requestId = id) => db.query(
  'INSERT INTO approval_requests(id,workspace_id,kind,title,body,payload) VALUES($1,$2,$3,$4,$5,$6)',
  [requestId, ws, kind, 'Review action', 'Exact reviewed parameters', p]);
const approve = (via = 'panel', principal: string | null = actor, at = 'clock_timestamp()') => db.query(
  `UPDATE approval_requests SET status='aprobada',decided_by=$1,decided_at=${at},decided_via=$2 WHERE id=$3`, [principal, via, id]);
describe('immutable HTTP approval review at the database boundary', () => {
  it('provides a private catalog-only deployment guard and detects a disabled trigger', async () => {
    await db.exec('SET ROLE service_role');
    expect((await db.query('SELECT http_approval_review_ready() AS ready')).rows[0]).toEqual({ ready: true });
    await db.exec('SET ROLE authenticated');
    await expect(db.exec('SELECT http_approval_review_ready()')).rejects.toThrow('permission denied');
    await db.exec('RESET ROLE;ALTER TABLE approval_requests DISABLE TRIGGER http_approval_review_snapshot');
    try { expect((await db.query('SELECT http_approval_review_ready() AS ready')).rows[0]).toEqual({ ready: false }); }
    finally { await db.exec('ALTER TABLE approval_requests ENABLE TRIGGER http_approval_review_snapshot'); }
  });
  it('allows a private proposal and its actual panel decision, receipt and notification metadata', async () => {
    await db.exec('SET ROLE service_role'); await insert();
    await db.query('UPDATE approval_requests SET notified_message_id=$1 WHERE id=$2', ['message', id]);
    await approve(); await db.query('UPDATE approval_requests SET result=$1,execution_result=$2 WHERE id=$3', ['Response received', { receipt_id: other }, id]);
    expect((await db.query('SELECT status,notified_message_id,execution_result FROM approval_requests')).rows[0])
      .toEqual({ status: 'aprobada', notified_message_id: 'message', execution_result: { receipt_id: other } });
  });
  it.each(['payload', 'body', 'title', 'workspace_id', 'kind', 'contact_id', 'expires_at', 'created_at', 'id'])('freezes reviewed %s even for the service', async field => {
    await insert(); await db.exec('SET ROLE service_role');
    const value = ['id', 'workspace_id', 'contact_id'].includes(field) ? other : field.endsWith('_at')
      ? '2027-01-01T00:00:00Z' : field === 'payload' ? { ...payload, input: { request: 'changed' } } : 'changed';
    await expect(db.query(`UPDATE approval_requests SET ${field}=$1 WHERE id=$2`, [value, id])).rejects.toThrow('snapshot_changed');
    expect((await db.query('SELECT body,payload FROM approval_requests')).rows[0]).toEqual({ body: 'Exact reviewed parameters', payload });
  });
  it('does not allow changing into or out of the reserved HTTP family', async () => {
    await insert(); await expect(db.query('UPDATE approval_requests SET payload=$1', [{ tool: 'legacy' }])).rejects.toThrow('snapshot_changed');
    await db.exec('TRUNCATE approval_requests'); await insert({ tool: 'legacy' });
    await expect(db.query('UPDATE approval_requests SET payload=$1', [payload])).rejects.toThrow('snapshot_changed');
  });
  it('blocks direct authenticated creation and decisions even if table write privileges exist', async () => {
    await insert(); await db.exec('SET ROLE authenticated');
    await expect(approve()).rejects.toThrow('service_required');
    await expect(insert(payload, workspace, 'herramienta', other)).rejects.toThrow('service_required');
    await expect(db.exec('SELECT freeze_http_approval_review()')).rejects.toThrow('permission denied');
  });
  it('preserves non-HTTP updates by their existing caller', async () => {
    await insert({ order_id: other }, workspace, 'pago_informado'); await db.exec('SET ROLE authenticated');
    await db.exec("UPDATE approval_requests SET status='rechazada',body='New evidence'");
    expect((await db.query('SELECT status,body FROM approval_requests')).rows[0]).toEqual({ status: 'rechazada', body: 'New evidence' });
  });
  it.each(['http_action_', 'http_flow_action_'])('also protects malformed and future reserved proposals: %s', async prefix => {
    await insert({ ...payload, tool: prefix + 'malformed' }); await db.exec('SET ROLE authenticated');
    await expect(db.exec("UPDATE approval_requests SET status='aprobada'")).rejects.toThrow('service_required');
  });
  it.each(['missing_key', 'wrong_kind', 'decided_insert'])('rejects invalid creation: %s', async kind => {
    if (kind === 'missing_key') await expect(insert({ tool: 'http_action_example_v1' })).rejects.toThrow('invalid_http_approval_proposal');
    if (kind === 'wrong_kind') await expect(insert(payload, workspace, 'pago_informado')).rejects.toThrow('invalid_http_approval_proposal');
    if (kind === 'decided_insert') await expect(db.query("INSERT INTO approval_requests(workspace_id,kind,payload,status) VALUES($1,'herramienta',$2,'aprobada')",
      [workspace, payload])).rejects.toThrow('invalid_http_approval_proposal');
  });
  it.each(['whatsapp', 'missing_actor', 'expired', 'future'])('rejects an unprotected first decision: %s', async kind => {
    await insert();
    await expect(approve(kind === 'whatsapp' ? 'whatsapp' : 'panel', kind === 'missing_actor' ? null : actor,
      kind === 'expired' ? "clock_timestamp()+interval '4 days'" : kind === 'future' ? "clock_timestamp()+interval '1 minute'" : 'clock_timestamp()'))
      .rejects.toThrow('invalid_http_approval_decision');
  });
  it('permits approved-to-failed receipt reporting but never resetting or changing the decider', async () => {
    await insert(); await approve(); await db.exec("UPDATE approval_requests SET status='fallida',result='Review required'");
    for (const statement of ["UPDATE approval_requests SET status='pendiente'", "UPDATE approval_requests SET status='aprobada'",
      `UPDATE approval_requests SET decided_by='${other}'`]) await expect(db.exec(statement)).rejects.toThrow('already_decided');
  });
  it.each(['aprobada', 'rechazada', 'vencida', 'fallida'])('retains dedupe after %s and permits a distinct workspace', async status => {
    await insert();
    if (['aprobada', 'rechazada'].includes(status)) {
      await approve(); if (status === 'rechazada') {
        await db.exec('TRUNCATE approval_requests'); await insert();
        await db.query("UPDATE approval_requests SET status='rechazada',decided_by=$1,decided_at=clock_timestamp(),decided_via='panel'", [actor]);
      }
    } else await db.query('UPDATE approval_requests SET status=$1', [status]);
    await expect(insert(payload, workspace, 'herramienta', other)).rejects.toThrow('duplicate key');
    await insert(payload, other, 'herramienta', other);
    expect((await db.query('SELECT count(*) AS count FROM approval_requests')).rows[0]).toEqual({ count: 2 });
  });
  it('accepts equivalent JSON key order without changing the reviewed proposal', async () => {
    await insert(); await db.query('UPDATE approval_requests SET payload=$1', [{ dedupe_key: payload.dedupe_key, input: payload.input, tool: payload.tool }]);
  });
});
