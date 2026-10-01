import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
const h = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('@/lib/capabilities/registry', () => ({ findCapability: () => ({ key: 'integraciones.http_ejecutar', run: h.run }) }));
vi.mock('./capabilities', () => ({ operatorCanUse: () => true }));
import { decideOperatorAction } from './actions';
const WS = '11111111-1111-4111-8111-111111111111', USER = '22222222-2222-4222-8222-222222222222';
const ID = '33333333-3333-4333-8333-333333333333', ACTION = '44444444-4444-4444-8444-444444444444';
let pending: boolean, audit: unknown[], filters: unknown[];
function db(): SupabaseClient {
  return { from: (table: string) => {
    const q = { update: () => q, select: () => q, eq: (key: string, value: unknown) => { filters.push([table, key, value]); return q; },
      insert: (row: unknown) => { audit.push(row); return Promise.resolve({ error: null }); },
      maybeSingle: async () => {
        if (!pending) return { data: null, error: null }; pending = false;
        return { error: null, data: { id: ACTION, capability_key: 'integraciones.http_ejecutar', risk: 'irreversible',
          args: { action_id: ID, expected_revision: 2, parameters: { arbitrary: { phone: 'PRIVATE_PHONE' } } } } };
      }, then: (resolve: (value: unknown) => void) => resolve({ error: null }) }; return q;
  } } as unknown as SupabaseClient;
}
beforeEach(() => { vi.clearAllMocks(); pending = true; audit = []; filters = [];
  h.run.mockResolvedValue({ receipt_id: ACTION, state: 'acknowledged', data: { email: 'PRIVATE_EMAIL' } }); });
describe('operator HTTP approved execution', () => {
  it('derives protected confirmation and invocation key from the claimed proposal', async () => {
    const result = await decideOperatorAction(db(), { actionId: ACTION, workspaceId: WS, userId: USER, aprobar: true });
    expect(result.ok).toBe(true); expect(h.run.mock.calls[0][0]).toMatchObject({ workspaceId: WS, actor: { type: 'operator', id: USER },
      httpExecution: { confirmed: true, invocationKey: expect.stringMatching(/^[0-9a-f]{64}$/) } });
    expect(filters).toContainEqual(['operator_actions', 'workspace_id', WS]); expect(filters).toContainEqual(['operator_actions', 'status', 'propuesto']);
    const first = h.run.mock.calls[0][0].httpExecution.invocationKey; pending = true;
    await decideOperatorAction(db(), { actionId: ACTION, workspaceId: WS, userId: USER, aprobar: true });
    expect(h.run.mock.calls[1][0].httpExecution.invocationKey).toBe(first);
  });
  it('does not dispatch a rejected or already-resolved proposal', async () => {
    await decideOperatorAction(db(), { actionId: ACTION, workspaceId: WS, userId: USER, aprobar: false });
    await decideOperatorAction(db(), { actionId: ACTION, workspaceId: WS, userId: USER, aprobar: true });
    expect(h.run).not.toHaveBeenCalled();
  });
  it('keeps nested inputs and selected provider data out of platform audit', async () => {
    await decideOperatorAction(db(), { actionId: ACTION, workspaceId: WS, userId: USER, aprobar: true });
    expect(JSON.stringify(audit)).not.toMatch(/PRIVATE_PHONE|PRIVATE_EMAIL|arbitrary/);
    expect(JSON.stringify(audit)).toContain(`http_acknowledged:${ACTION}`);
  });
  it('reports unresolved execution as failure instead of done', async () => {
    h.run.mockRejectedValue(new Error('El resultado anterior requiere revisión antes de otra ejecución.'));
    const result = await decideOperatorAction(db(), { actionId: ACTION, workspaceId: WS, userId: USER, aprobar: true });
    expect(result).toMatchObject({ ok: false, status: 'fallido' }); expect(result).not.toHaveProperty('result');
    expect(JSON.stringify(audit)).not.toContain('PRIVATE_PHONE');
  });
});
