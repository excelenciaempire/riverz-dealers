import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapabilityContext } from './types';
const h = vi.hoisted(() => ({ visible: true, access: vi.fn(), load: vi.fn(), execute: vi.fn(), bindings: vi.fn() }));
vi.mock('@/lib/ui/improvements-preview', () => ({ get SHOW_RIVERZ_IMPROVEMENTS() { return h.visible; } }));
vi.mock('@/lib/mcp/access', () => ({ userAccess: h.access }));
vi.mock('@/lib/integrations/http-action-store', async original => ({ ...await original<typeof import('@/lib/integrations/http-action-store')>(), loadHttpAction: h.load }));
vi.mock('@/lib/integrations/http-action-executor', async original => ({ ...await original<typeof import('@/lib/integrations/http-action-executor')>(),
  executeHttpAction: h.execute, httpActionBindingsForConversation: h.bindings }));
import { HTTP_ACTION_CAPABILITIES } from './http-actions';
const WS = '11111111-1111-4111-8111-111111111111', USER = '22222222-2222-4222-8222-222222222222';
const ID = '33333333-3333-4333-8333-333333333333', CONV = '44444444-4444-4444-8444-444444444444';
const definition = () => ({ name: 'Status', description: 'Provider status lookup', method: 'GET', url: 'https://integration.test/query',
  credential_kind: 'none', parameters: [{ key: 'order', type: 'string', required: true }], outputs: [] });
const args = () => ({ action_id: ID, expected_revision: 2, parameters: { order: 'fixture-order' } });
const cap = (name: string) => HTTP_ACTION_CAPABILITIES.find(c => c.key === `integraciones.http_${name}`)!;
let rows: unknown, error: unknown, filters: unknown[];
function ctx(): CapabilityContext {
  const q = { select: () => q, eq: (k: string, v: unknown) => { filters.push([k, v]); return q; }, order: () => q, limit: async () => ({ data: rows, error }) };
  return { db: { from: () => q } as unknown as CapabilityContext['db'], workspaceId: WS, actor: { type: 'operator', id: USER }, locale: 'en' };
}
beforeEach(() => {
  vi.clearAllMocks(); h.visible = true; filters = []; error = null;
  h.access.mockResolvedValue({ admin: true, sections: null }); h.bindings.mockResolvedValue(null);
  h.load.mockResolvedValue({ id: ID, revision: 2, state: 'active', definition: definition() });
  h.execute.mockResolvedValue({ id: CONV, state: 'acknowledged', status_code: 200, error_code: null, result: {}, cached: false });
  rows = [{ id: ID, workspace_id: WS, revision: 2, state: 'active', definition: definition() }];
});
describe('staged HTTP capabilities', () => {
  it('provides bounded active metadata without origins, credentials or bound identity fields', async () => {
    rows = [{ id: ID, workspace_id: WS, revision: 2, state: 'active', definition: { ...definition(),
      parameters: [{ key: 'customer', source: 'contact_id', type: 'string', required: true }, ...definition().parameters] } }];
    const result = await cap('catalogo').run(ctx(), {});
    expect(result).toMatchObject({ actions: [{ action_id: ID, expected_revision: 2, risk: 'lectura', requires_conversation: true,
      input: { properties: { order: { type: 'string' } }, required: ['order'] } }] });
    expect(JSON.stringify(result)).not.toMatch(/integration\.test|credential|contact_id|customer/); expect(filters).toContainEqual(['workspace_id', WS]);
  });
  it.each(['hidden', 'no-member', 'no-section', 'cron', 'mcp-without-issuer'])('denies %s actors before catalog reads', async mode => {
    const context = ctx();
    if (mode === 'hidden') h.visible = false;
    else if (mode === 'no-member') h.access.mockResolvedValue(null);
    else if (mode === 'no-section') h.access.mockResolvedValue({ admin: true, sections: [] });
    else if (mode === 'cron') context.actor = { type: 'cron', id: USER };
    else context.actor = { type: 'mcp', id: USER };
    await expect(cap('catalogo').run(context, {})).rejects.toThrow(); expect(filters).toEqual([]);
  });
  it.each(['foreign', 'malformed', 'query-error'])('does not turn %s catalog data into a successful list', async mode => {
    if (mode === 'foreign') rows = [{ ...(rows as object[])[0], workspace_id: USER }];
    else if (mode === 'malformed') rows = null; else error = { message: 'PRIVATE' };
    await expect(cap('catalogo').run(ctx(), {})).rejects.toThrow('could not be confirmed');
  });
  it('derives GET invocation keys inside the server and preserves owned context', async () => {
    const result = await cap('consultar').run(ctx(), args());
    expect(h.execute.mock.calls[0][1]).toMatchObject({ actorUserId: USER, workspaceId: WS, actionId: ID, confirmed: false,
      invocationKey: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(result).toMatchObject({ external_data_untrusted: true, receipt_id: CONV });
    expect(result).toHaveProperty('message', expect.stringContaining('Business completion remains unverified'));
  });
  it.each(['invocation_key', 'confirmed', 'actor_id', 'workspaceId', 'url', 'credential'])('rejects model-provided authority field %s', async key => {
    await expect(cap('consultar').run(ctx(), { ...args(), [key]: 'FORGED' })).rejects.toThrow('parameters');
    expect(h.execute).not.toHaveBeenCalled();
  });
  it('denies method and revision mismatch without execution', async () => {
    h.load.mockResolvedValue({ revision: 3, state: 'active', definition: definition() });
    await expect(cap('consultar').run(ctx(), args())).rejects.toThrow('changed');
    h.load.mockResolvedValue({ revision: 2, state: 'active', definition: { ...definition(), method: 'POST' } });
    await expect(cap('consultar').run(ctx(), args())).rejects.toThrow('unavailable'); expect(h.execute).not.toHaveBeenCalled();
  });
  it('requires server approval for POST rather than a model confirmation', async () => {
    h.load.mockResolvedValue({ revision: 2, state: 'active', definition: { ...definition(), method: 'POST' } });
    await expect(cap('ejecutar').run(ctx(), args())).rejects.toThrow('administrator');
    const context = ctx(); context.httpExecution = { invocationKey: 'b'.repeat(64), confirmed: true };
    await cap('ejecutar').run(context, args()); expect(h.execute.mock.calls[0][1]).toMatchObject(context.httpExecution);
  });
  it.each(['claimed', 'blocked', 'uncertain'])('never presents %s receipt as completed', async state => {
    h.execute.mockResolvedValue({ id: CONV, state, result: null });
    await expect(cap('consultar').run(ctx(), args())).rejects.toThrow();
  });
  it('previews the exact active POST version and inputs without executing it', async () => {
    h.load.mockResolvedValue({ revision: 2, state: 'active', definition: { ...definition(), method: 'POST' } });
    expect(await cap('ejecutar').preview!(ctx(), args())).toContain('fixture-order');
    expect(h.execute).not.toHaveBeenCalled(); expect(h.bindings).toHaveBeenCalledTimes(1);
  });
  it('rejects missing or invalid bound context before producing an approvable preview', async () => {
    h.load.mockResolvedValue({ revision: 2, state: 'active', definition: { ...definition(), method: 'POST',
      parameters: [{ key: 'customer', source: 'contact_id', type: 'string', required: true }] } });
    await expect(cap('ejecutar').preview!(ctx(), { ...args(), parameters: {} })).rejects.toThrow('parameters');
    h.bindings.mockRejectedValue(new Error('PRIVATE_CONTACT_ERROR'));
    await expect(cap('ejecutar').preview!(ctx(), { ...args(), parameters: {}, conversation_id: CONV })).rejects.toThrow('could not be confirmed');
    expect(h.execute).not.toHaveBeenCalled();
  });
  it('localizes preview and errors for Spanish', async () => {
    const context = ctx(); context.locale = 'es';
    h.load.mockResolvedValue({ revision: 2, state: 'active', definition: { ...definition(), method: 'POST' } });
    expect(await cap('ejecutar').preview!(context, args())).toContain('Enviar POST');
    await expect(cap('ejecutar').run(context, args())).rejects.toThrow('administrador');
  });
});
