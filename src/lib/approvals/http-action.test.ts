import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
const h = vi.hoisted(() => ({ visible: true, access: vi.fn(), execute: vi.fn() }));
vi.mock('@/lib/ui/improvements-preview', () => ({ get SHOW_RIVERZ_IMPROVEMENTS() { return h.visible; } }));
vi.mock('@/lib/mcp/access', () => ({ userAccess: h.access }));
vi.mock('@/lib/integrations/http-action-executor', () => ({ executeHttpAssistantAction: h.execute }));
vi.mock('@/lib/i18n/cuenta', () => ({ localeDeCuenta: async () => 'es' }));
import { canDecideHttpAction, executeApprovedHttpAction } from './http-action';
import { decidir, resolveByCode } from './resolve';
const WS = '11111111-1111-4111-8111-111111111111', ACTOR = '22222222-2222-4222-8222-222222222222';
const ACTION = '33333333-3333-4333-8333-333333333333', AGENT = '44444444-4444-4444-8444-444444444444';
const CONV = '55555555-5555-4555-8555-555555555555', CONTACT = '66666666-6666-4666-8666-666666666666';
const APPROVAL = '77777777-7777-4777-8777-777777777777', RUN = '88888888-8888-4888-8888-888888888888';
const payload = () => ({ tool: `http_action_${ACTION.replaceAll('-', '')}_v2`, input: { reference: 'one' }, contact_id: CONTACT,
  conversation_id: CONV, agent_id: AGENT, http_action_context: { contact_id: CONTACT, conversation_id: CONV, phone: '+10000000000', email: null },
  http_action: { action_id: ACTION, action_revision: 2, grant_revision: 1, channel: 'whatsapp' } });
const ctx = () => ({ workspaceId: WS, approvalId: APPROVAL, actorId: ACTOR });
beforeEach(() => {
  vi.clearAllMocks(); h.visible = true; h.access.mockResolvedValue({ admin: true, sections: null });
  h.execute.mockResolvedValue({ id: RUN, state: 'acknowledged', status_code: 200, error_code: null,
    result: { selected_customer_data: 'PRIVATE_SELECTED' }, cached: false });
});
describe('protected HTTP approval consumer', () => {
  it('requires comparison, exact frozen metadata, current administration and panel identity before consuming an approval', async () => {
    const db = {} as SupabaseClient;
    expect(await canDecideHttpAction(db, WS, ACTOR, payload(), 'panel')).toBe(true);
    for (const [actor, p, via] of [[null, payload(), 'panel'], [ACTOR, payload(), 'whatsapp'],
      [ACTOR, { ...payload(), tool: 'http_action_wrong' }, 'panel'], [ACTOR, { ...payload(), confirmed: true }, 'panel']] as const) {
      expect(await canDecideHttpAction(db, WS, actor, p, via)).toBe(false);
    }
    h.access.mockResolvedValue({ admin: true, sections: ['/automatizaciones', '/bandeja'] });
    expect(await canDecideHttpAction(db, WS, ACTOR, payload(), 'panel')).toBe(false);
    h.visible = false; h.access.mockClear(); expect(await canDecideHttpAction(db, WS, ACTOR, payload(), 'panel')).toBe(false);
    expect(h.access).not.toHaveBeenCalled();
  });
  it('passes actual approval and decider identifiers separately from model inputs and returns receipt metadata only', async () => {
    const result = await executeApprovedHttpAction({} as SupabaseClient, ctx(), payload(), 'en');
    expect(result).toMatchObject({ ok: true, execution: { receipt_id: RUN, state: 'acknowledged', business_completion_verified: false } });
    expect(h.execute.mock.calls[0][1]).toMatchObject({ workspaceId: WS, agentId: AGENT, actionId: ACTION, expectedRevision: 2,
      grantRevision: 1, conversationId: CONV, approvalId: APPROVAL, approvalActorId: ACTOR, invocationKey: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(h.execute.mock.calls[0][2]).toEqual({ reference: 'one' }); expect(JSON.stringify(result)).not.toContain('PRIVATE_SELECTED');
    await executeApprovedHttpAction({} as SupabaseClient, ctx(), payload(), 'es');
    expect(h.execute.mock.calls[1][1].invocationKey).toBe(h.execute.mock.calls[0][1].invocationKey);
  });
  it.each(['claimed', 'blocked', 'uncertain'])('does not acknowledge completion for %s', async state => {
    h.execute.mockResolvedValue({ id: RUN, state, status_code: null, result: null, cached: false });
    expect(await executeApprovedHttpAction({} as SupabaseClient, ctx(), payload(), 'es')).toMatchObject({ ok: false, uncertain: state !== 'blocked' });
  });
  it('fails closed on malformed protected context and private gateway exceptions', async () => {
    expect((await executeApprovedHttpAction({} as SupabaseClient, { ...ctx(), actorId: 'model' }, payload(), 'en')).ok).toBe(false);
    expect(h.execute).not.toHaveBeenCalled(); h.execute.mockRejectedValue(new Error('PRIVATE_GATEWAY'));
    const result = await executeApprovedHttpAction({} as SupabaseClient, ctx(), payload(), 'es');
    expect(result).toMatchObject({ ok: false, uncertain: true }); expect(JSON.stringify(result)).not.toContain('PRIVATE_GATEWAY');
  });
});

function fixture() {
  const row: Record<string, unknown> = { id: APPROVAL, workspace_id: WS, kind: 'herramienta', status: 'pendiente', payload: payload(),
    expires_at: new Date(Date.now() + 60000).toISOString(), title: 'Configured action', notified_phone: '573001234567' };
  let failFinal = false, reorder = false;
  const db = { from(table: string) {
    let patch: Record<string, unknown> | null = null, fields = '*';
    const filters: Array<(row: Record<string, unknown>) => boolean> = [];
    function resolve(single: boolean) {
      if (table !== 'approval_requests' || !filters.every(filter => filter(row))) return { data: single ? null : [], error: null };
      if (patch && Object.hasOwn(patch, 'execution_result') && failFinal) return { data: null, error: { message: 'PRIVATE_PERSISTENCE' } };
      if (patch) Object.assign(row, patch);
      const result = fields === '*' ? { ...row } : Object.fromEntries(fields.split(',').map(key => [key.trim(), row[key.trim()]]));
      if (reorder && result.execution_result && typeof result.execution_result === 'object') {
        result.execution_result = Object.fromEntries(Object.entries(result.execution_result).reverse());
      }
      return { data: single ? result : [result], error: null };
    }
    const query = { select: (value: string) => { fields = value; return query; }, update: (value: Record<string, unknown>) => { patch = value; return query; },
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query; },
      gt: (key: string, value: string) => { filters.push(row => String(row[key]) > value); return query; },
      like: (key: string, value: string) => { filters.push(row => String(row[key]).endsWith(value.slice(1))); return query; },
      order: () => query, limit: () => query, maybeSingle: async () => resolve(true), then: (done: (value: unknown) => unknown) => Promise.resolve(resolve(false)).then(done) };
    return query;
  } } as unknown as SupabaseClient;
  return { db, row, failFinal: () => { failFinal = true; }, reorder: () => { reorder = true; } };
}
const decision = () => ({ approvalId: APPROVAL, workspaceId: WS, decision: 'aprobada' as const, via: 'panel' as const, decidedBy: ACTOR });
describe('HTTP decision orchestration', () => {
  it('cannot consume the proposal as a non-admin, an unrelated workspace or a WhatsApp suffix', async () => {
    const { db, row } = fixture(); h.access.mockResolvedValue({ admin: false, sections: null });
    expect((await decidir(db, decision())).ok).toBe(false); expect(row.status).toBe('pendiente');
    h.access.mockResolvedValue({ admin: true, sections: null });
    expect((await decidir(db, { ...decision(), workspaceId: ACTOR })).ok).toBe(false); expect(row.status).toBe('pendiente');
    expect((await resolveByCode(db, { code: APPROVAL.slice(0, 6), decision: 'aprobada', phone: '193001234567' })).ok).toBe(false);
    expect(row.status).toBe('pendiente'); expect(h.execute).not.toHaveBeenCalled();
  });
  it('executes one concurrent decision only and preserves the actual decider', async () => {
    const { db, row } = fixture();
    const results = await Promise.all([decidir(db, decision()), decidir(db, decision())]);
    expect(results.filter(result => result.ok)).toHaveLength(1); expect(h.execute).toHaveBeenCalledTimes(1);
    expect(row.decided_by).toBe(ACTOR); expect(row.status).toBe('aprobada'); expect(JSON.stringify(row.execution_result)).not.toContain('PRIVATE_SELECTED');
  });
  it('confirms metadata regardless of JSONB key order and blocks replay after persistence failure', async () => {
    const first = fixture(); first.reorder(); expect((await decidir(first.db, decision())).ok).toBe(true);
    const second = fixture(); second.failFinal(); expect(await decidir(second.db, decision())).toMatchObject({ ok: false, uncertain: true });
    const count = h.execute.mock.calls.length; expect((await decidir(second.db, decision())).ok).toBe(false); expect(h.execute).toHaveBeenCalledTimes(count);
  });
  it('rejecting an authorized proposal never executes it', async () => {
    const { db, row } = fixture(); expect((await decidir(db, { ...decision(), decision: 'rechazada' })).ok).toBe(true);
    expect(row.status).toBe('rechazada'); expect(h.execute).not.toHaveBeenCalled();
  });
});
