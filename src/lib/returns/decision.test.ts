/* eslint-disable @typescript-eslint/no-explicit-any -- Stateful Supabase query double. */
import { beforeEach, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { decideReturn } from './decision';
import { BANDEJA_CAPABILITIES } from '@/lib/capabilities/bandeja';
import type { CapabilityContext } from '@/lib/capabilities/types';

const ws = '11111111-1111-4111-8111-111111111111', user = '22222222-2222-4222-8222-222222222222', id = '33333333-3333-4333-8333-333333333333';
const oldDate = '2026-10-01T12:00:00.123456Z';
let rows: any[], members: any[], contacts: any[], writes: any[], errorTable: string | undefined, loseRace: boolean;
function context(locale: 'es' | 'en' = 'es'): CapabilityContext {
  const db = { from(table: string) {
    const conditions: Array<(row: any) => boolean> = [];
    let update: any;
    const q: any = {
      select: () => q,
      order: () => q, limit: () => q,
      in: (key: string, values: unknown[]) => { conditions.push(row => values.includes(row[key])); return q; },
      eq: (key: string, value: unknown) => { conditions.push(row => row[key] === value); return q; },
      is: (key: string, value: unknown) => { conditions.push(row => row[key] === value); return q; },
      update: (value: unknown) => { update = value; return q; },
      maybeSingle: async () => {
        if (table === errorTable) return { data: null, error: { message: 'private SQL failure' } };
        if (update && loseRace) rows[0].updated_at = '2026-10-01T12:01:00Z';
        const row = (table === 'workspace_members' ? members : rows).find(value => conditions.every(test => test(value)));
        if (row && update) { writes.push({ ...update }); Object.assign(row, update, { updated_at: '2026-10-01T12:02:00.123456Z' }); }
        return { data: row ? { ...row } : null, error: null };
      },
      then: (resolve: (value: unknown) => unknown) => resolve({ data: (table === 'contacts' ? contacts : rows).filter(row => conditions.every(test => test(row))).map(row => ({ ...row })), error: table === errorTable ? { message: 'private SQL failure' } : null }),
    };
    return q;
  } } as unknown as SupabaseClient;
  return { db, workspaceId: ws, actor: { type: 'operator', id: user }, locale };
}
beforeEach(() => {
  rows = [{ id, workspace_id: ws, order_number: '#1', kind: 'devolucion', reason: 'damaged', status: 'abierta', resolution: 'Keep this note', updated_at: oldDate, platform: null }];
  members = [{ workspace_id: ws, user_id: user }]; contacts = [{ id: 'own-contact', workspace_id: ws }]; writes = []; errorTable = undefined; loseRace = false;
});
const cap = BANDEJA_CAPABILITIES.find(value => value.key === 'bandeja.decidir_devolucion')!;

describe('shared return case decisions', () => {
  it('updates the matching local case, preserves an omitted note and records its authenticated actor', async () => {
    const result = await decideReturn(context().db, ws, user, { id, status: 'aprobada', expected_updated_at: oldDate });
    expect(result.status).toBe('aprobada'); expect(result.unchanged).toBe(false);
    expect(writes).toEqual([expect.objectContaining({ decided_by: user, status: 'aprobada', resolution: 'Keep this note' })]);
  });
  it('allows explicit note replacement or clearing', async () => {
    await decideReturn(context().db, ws, user, { id, status: 'aprobada', resolution: ' Reviewed ' });
    expect(writes[0].resolution).toBe('Reviewed');
    await decideReturn(context().db, ws, user, { id, status: 'aprobada', resolution: null });
    expect(writes[1].resolution).toBeNull();
  });
  it('does not overwrite decision attribution on a repeated identical request', async () => {
    const db = context().db;
    await decideReturn(db, ws, user, { id, status: 'aprobada', expected_updated_at: oldDate });
    expect((await decideReturn(db, ws, user, { id, status: 'aprobada', expected_updated_at: oldDate })).unchanged).toBe(true);
    expect(writes).toHaveLength(1);
  });
  it.each(['mercadolibre', 'shopify'])('rejects locally deciding a %s-managed case', async platform => {
    rows[0].platform = platform;
    await expect(decideReturn(context().db, ws, user, { id, status: 'resuelta' })).rejects.toMatchObject({ code: 'platformManaged' });
    expect(writes).toEqual([]);
  });
  it('rejects foreign cases, revoked members and invalid actors without writing', async () => {
    rows[0].workspace_id = 'foreign';
    await expect(decideReturn(context().db, ws, user, { id, status: 'aprobada' })).rejects.toMatchObject({ code: 'notFound' });
    members = [];
    await expect(decideReturn(context().db, ws, user, { id, status: 'aprobada' })).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(decideReturn(context().db, ws, 'token-id', { id, status: 'aprobada' })).rejects.toMatchObject({ code: 'unauthorized' });
    expect(writes).toEqual([]);
  });
  it('rejects stale UI observations and a concurrent change between reading and updating', async () => {
    await expect(decideReturn(context().db, ws, user, { id, status: 'aprobada', expected_updated_at: '2026-10-01T11:00:00Z' })).rejects.toMatchObject({ code: 'decisionChanged' });
    loseRace = true;
    await expect(decideReturn(context().db, ws, user, { id, status: 'aprobada' })).rejects.toMatchObject({ code: 'decisionChanged' });
    expect(writes).toEqual([]);
  });
  it.each(['workspace_members', 'returns'])('reports a failed %s query without private SQL detail', async table => {
    errorTable = table;
    await expect(decideReturn(context().db, ws, user, { id, status: 'aprobada' })).rejects.toMatchObject({ code: 'saveFailed' });
    expect(writes).toEqual([]);
  });
  it.each(['abierta', 'aprobada', 'rechazada', 'recibida', 'resuelta'] as const)('preserves the existing %s state contract', async status => {
    expect((await decideReturn(context().db, ws, user, { id, status })).status).toBe(status);
  });
});

describe('Operator/MCP use the same return decision', () => {
  it('includes the observed modification date and management source without leaking an inconsistent contact', async () => {
    rows[0].contacts = { id: 'foreign-contact', name: 'private foreign name' }; rows[0].platform = 'mercadolibre';
    const list = BANDEJA_CAPABILITIES.find(value => value.key === 'bandeja.devoluciones')!;
    const result = await list.run(context('en'), {}) as any;
    expect(result.devoluciones[0]).toMatchObject({ updated_at: oldDate, plataforma: 'mercadolibre', gestionable_aqui: false, cliente: 'No name' });
    expect(JSON.stringify(result)).not.toContain('private foreign name');
  });
  it('attributes an MCP decision to the authenticated issuer, not the key id', async () => {
    const ctx = context(); ctx.actor = { type: 'mcp', id: 'api-key-id', userId: user };
    const result = await cap.run(ctx, { devolucion_id: id, estado: 'aprobada' }) as any;
    expect(result.reembolso_ejecutado).toBe(false); expect(writes[0].decided_by).toBe(user);
  });
  it.each(['es', 'en'] as const)('localizes the preview and explains the actual effect in %s', async locale => {
    const ctx = context(locale);
    const text = await cap.preview!(ctx, { devolucion_id: id, estado: 'aprobada' });
    expect(text).toContain(locale === 'en' ? 'does not execute a refund' : 'no ejecuta un reembolso');
    expect(JSON.stringify(cap.artifact!(ctx, { estado: 'aprobada' }, null))).toContain(locale === 'en' ? 'does not execute a refund' : 'No ejecuta un reembolso');
    rows[0].platform = 'mercadolibre';
    await expect(cap.run(ctx, { devolucion_id: id, estado: 'resuelta' })).rejects.toThrow(locale === 'en' ? 'source platform' : 'plataforma de origen');
    await expect(cap.preview!(ctx, { devolucion_id: id, estado: 'resuelta' })).rejects.toThrow(locale === 'en' ? 'source platform' : 'plataforma de origen');
    expect(writes).toEqual([]);
  });
});
