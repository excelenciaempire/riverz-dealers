import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
const h = vi.hoisted(() => ({ visible: true, access: vi.fn(), bindings: vi.fn(), execute: vi.fn(), ask: vi.fn(), identity: vi.fn(), writable: vi.fn(), merchantLocale: 'es' }));
vi.mock('@/lib/ui/improvements-preview', () => ({ get SHOW_RIVERZ_IMPROVEMENTS() { return h.visible; } }));
vi.mock('@/lib/mcp/access', () => ({ userAccess: h.access }));
vi.mock('@/lib/integrations/http-action-executor', () => ({ executeHttpAssistantAction: h.execute, httpActionBindingsForConversation: h.bindings }));
vi.mock('@/lib/integrations/http-assistant-identity', () => ({ httpAssistantIdentityAllowed: h.identity }));
vi.mock('@/lib/approvals/ask', () => ({ askForApproval: h.ask }));
vi.mock('@/lib/billing/read-only', () => ({ assertWorkspaceWritable: h.writable }));
vi.mock('@/lib/i18n/cuenta', () => ({ localeDeCuenta: async () => h.merchantLocale }));
import { loadHttpAssistantTools, runHttpAssistantTool, type HttpAssistantToolRuntime } from './http-actions';
const WS = '11111111-1111-4111-8111-111111111111', OWNER = '22222222-2222-4222-8222-222222222222';
const ACTION = '33333333-3333-4333-8333-333333333333', AGENT = '44444444-4444-4444-8444-444444444444';
const CONV = '55555555-5555-4555-8555-555555555555', CONTACT = '66666666-6666-4666-8666-666666666666';
const INBOUND = '77777777-7777-4777-8777-777777777777', RUN = '88888888-8888-4888-8888-888888888888';
const scope = () => ({ workspaceId: WS, agentId: AGENT, channel: 'whatsapp', conversationId: CONV, contactId: CONTACT, locale: 'es' as const });
let rows: Record<string, Array<Record<string, unknown>>>, reads: Array<[string, string, unknown]>;
function db(): SupabaseClient {
  return { from(table: string) {
    let fields = '*', limit = 100;
    const filters: Array<(row: Record<string, unknown>) => boolean> = [];
    const resolve = () => (rows[table] ?? []).filter(row => filters.every(predicate => predicate(row))).slice(0, limit)
      .map(row => fields === '*' ? row : Object.fromEntries(fields.split(',').map(key => [key.trim(), row[key.trim()]])));
    const query = { select: (value: string) => { fields = value; return query; },
      eq: (key: string, value: unknown) => { reads.push([table, key, value]); filters.push(row => row[key] === value); return query; },
      is: (key: string, value: unknown) => { reads.push([table, key, value]); filters.push(row => row[key] === value); return query; },
      limit: (value: number) => { limit = value; return query; }, maybeSingle: async () => ({ data: resolve()[0] ?? null, error: null }),
      then: (done: (value: unknown) => unknown) => Promise.resolve({ data: resolve(), error: null }).then(done) };
    return query;
  } } as unknown as SupabaseClient;
}
beforeEach(() => {
  vi.clearAllMocks(); h.visible = true; h.merchantLocale = 'es'; reads = [];
  rows = { ai_agents: [{ id: AGENT, workspace_id: WS, scope: 'workspace', is_active: true, assigned_only: false, deleted_at: null }],
    conversations: [{ id: CONV, workspace_id: WS, contact_id: CONTACT, channel: 'whatsapp', assigned_ai_agent_id: null, deleted_at: null }],
    http_action_assistant_grants: [{ workspace_id: WS, agent_id: AGENT, action_id: ACTION, channel: 'whatsapp', state: 'active',
      action_revision: 2, revision: 1, context_scope: 'contact', granted_by: OWNER }],
    http_actions: [{ id: ACTION, workspace_id: WS, revision: 2, state: 'active', credential_ciphertext: 'NEVER_EXPOSE', definition: {
      name: 'Lookup fixture', description: 'Read an external status', method: 'GET', url: 'https://configured.test/status', credential_kind: 'bearer',
      parameters: [{ key: 'customer', source: 'contact_id', type: 'string', required: true }, { key: 'reference', type: 'string', required: true }],
      outputs: [{ key: 'status', type: 'string', path: ['status'], required: true }] } }] };
  h.identity.mockResolvedValue(true); h.access.mockResolvedValue({ admin: true, sections: null });
  h.bindings.mockResolvedValue({ contact_id: CONTACT, conversation_id: CONV, phone: '+10000000000', email: null });
  h.execute.mockResolvedValue({ id: RUN, state: 'acknowledged', status_code: 200, error_code: null, result: { status: 'received' }, cached: false });
  h.ask.mockResolvedValue({ ok: true, notified: true, approvalId: RUN }); h.writable.mockResolvedValue(undefined);
});
async function runtime(): Promise<HttpAssistantToolRuntime> { return { scope: scope(), inboundId: INBOUND, tools: await loadHttpAssistantTools(db(), scope()) }; }
const definition = () => rows.http_actions[0].definition as Record<string, unknown>;
describe('explicit customer-assistant HTTP tools', () => {
  it('performs no reads and offers no tools outside comparison', async () => {
    h.visible = false; expect(await loadHttpAssistantTools(db(), scope())).toEqual([]);
    expect(JSON.parse(await runHttpAssistantTool(db(), null, 'http_action_unknown', {})).ok).toBe(false);
    expect(reads).toEqual([]); expect(h.access).not.toHaveBeenCalled(); expect(h.ask).not.toHaveBeenCalled();
  });
  it('offers a frozen concrete tool with only free fields, without URL, authentication, grantor or bound customer fields', async () => {
    const tools = await loadHttpAssistantTools(db(), scope()); expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ actionId: ACTION, actionRevision: 2, grantRevision: 1, method: 'GET',
      tool: { name: `http_action_${ACTION.replaceAll('-', '')}_v2`, input_schema: { type: 'object', additionalProperties: false, required: ['reference'] } } });
    expect(tools[0].tool.input_schema.properties).toEqual({ reference: { type: 'string', maxLength: 2000 } });
    expect(JSON.stringify(tools)).not.toMatch(/configured\.test|NEVER_EXPOSE|bearer|customer|22222222/);
    expect(reads).toContainEqual(['http_action_assistant_grants', 'workspace_id', WS]);
  });
  it.each(['no-grant', 'withdrawn', 'old-version', 'paused', 'foreign', 'assigned', 'uncovered', 'unsupported-channel'])('omits %s configuration', async mode => {
    if (mode === 'no-grant') rows.http_action_assistant_grants = [];
    if (mode === 'withdrawn') rows.http_action_assistant_grants[0].state = 'withdrawn';
    if (mode === 'old-version') rows.http_actions[0].revision = 3;
    if (mode === 'paused') rows.ai_agents[0].is_active = false;
    if (mode === 'foreign') rows.ai_agents[0].workspace_id = ACTION;
    if (mode === 'assigned') rows.ai_agents[0].assigned_only = true;
    if (mode === 'uncovered') rows.ai_agents[0].scope = 'channels';
    expect(await loadHttpAssistantTools(db(), mode === 'unsupported-channel' ? { ...scope(), channel: 'mercadolibre' } : scope())).toEqual([]);
  });
  it('does not allow a different current customer/profile assignment and rejects stale authority', async () => {
    rows.conversations[0].contact_id = OWNER; expect(await loadHttpAssistantTools(db(), scope())).toEqual([]);
    rows.conversations[0].contact_id = CONTACT; rows.conversations[0].assigned_ai_agent_id = ACTION;
    expect(await loadHttpAssistantTools(db(), scope())).toEqual([]);
    rows.conversations[0].assigned_ai_agent_id = null; h.access.mockResolvedValue({ admin: true, sections: ['/automatizaciones', '/bandeja'] });
    expect(await loadHttpAssistantTools(db(), scope())).toEqual([]);
  });
  it.each(['ig_comment', 'fb_comment', 'voice'])('does not offer private lookup tools on the unsupported %s surface', async channel => {
    expect(await loadHttpAssistantTools(db(), { ...scope(), channel, conversationId: undefined, contactId: undefined })).toEqual([]);
    expect(reads).toEqual([]);
  });
  it('fails closed on an overflowing grant catalog and invalid business-wide parameters', async () => {
    rows.http_action_assistant_grants = Array.from({ length: 13 }, () => ({ ...rows.http_action_assistant_grants[0] }));
    expect(await loadHttpAssistantTools(db(), scope())).toEqual([]);
    rows.http_action_assistant_grants = [rows.http_action_assistant_grants[0]]; rows.http_action_assistant_grants[0].context_scope = 'business';
    expect(await loadHttpAssistantTools(db(), scope())).toEqual([]);
    definition().parameters = []; expect(await loadHttpAssistantTools(db(), scope())).toHaveLength(1);
    definition().method = 'POST'; expect(await loadHttpAssistantTools(db(), scope())).toEqual([]);
  });
  it('uses a stable invocation for the actual inbound message and marks external data untrusted', async () => {
    const ctx = await runtime(), name = ctx.tools[0].tool.name;
    const result = JSON.parse(await runHttpAssistantTool(db(), ctx, name, { reference: 'one' }));
    expect(result).toMatchObject({ ok: true, receipt_id: RUN, data: { status: 'received' }, external_data_untrusted: true, business_completion_verified: false });
    expect(h.execute.mock.calls[0][1]).toMatchObject({ workspaceId: WS, agentId: AGENT, conversationId: CONV,
      actionId: ACTION, expectedRevision: 2, grantRevision: 1, channel: 'whatsapp', invocationKey: expect.stringMatching(/^[0-9a-f]{64}$/) });
    await runHttpAssistantTool(db(), ctx, name, { reference: 'one' }); expect(h.execute.mock.calls[1][1].invocationKey).toBe(h.execute.mock.calls[0][1].invocationKey);
    await runHttpAssistantTool(db(), { ...ctx, inboundId: RUN }, name, { reference: 'one' });
    expect(h.execute.mock.calls[2][1].invocationKey).not.toBe(h.execute.mock.calls[0][1].invocationKey);
    expect(h.ask).not.toHaveBeenCalled();
  });
  it('rejects model identity/authority fields, absent offered tools and changed grant metadata', async () => {
    const ctx = await runtime(), name = ctx.tools[0].tool.name;
    for (const input of [{ reference: 'one', customer: OWNER }, { reference: 'one', approved: true }]) {
      expect(JSON.parse(await runHttpAssistantTool(db(), ctx, name, input)).ok).toBe(false);
    }
    expect(JSON.parse(await runHttpAssistantTool(db(), { ...ctx, tools: [] }, name, { reference: 'one' })).ok).toBe(false);
    rows.http_action_assistant_grants[0].revision = 2;
    expect(JSON.parse(await runHttpAssistantTool(db(), ctx, name, { reference: 'one' })).ok).toBe(false);
    expect(h.execute).not.toHaveBeenCalled(); expect(h.ask).not.toHaveBeenCalled();
  });
  it('creates an exact human proposal for POST, without invoking the executor or claiming completion', async () => {
    definition().method = 'POST'; const ctx = await runtime(), name = ctx.tools[0].tool.name;
    expect(JSON.parse(await runHttpAssistantTool(db(), ctx, name, { reference: 'one' })))
      .toMatchObject({ ok: true, estado: 'pendiente_de_aprobacion', confirmed: false, notified: true, approval_id: RUN });
    expect(h.ask.mock.calls[0][0]).toMatchObject({ workspaceId: WS, kind: 'herramienta', dedupeKey: expect.stringMatching(/^http:[0-9a-f]{64}$/),
      payload: { tool: name, input: { reference: 'one' }, contact_id: CONTACT, conversation_id: CONV, agent_id: AGENT,
        http_action: { action_id: ACTION, action_revision: 2, grant_revision: 1, channel: 'whatsapp' } } });
    expect(h.ask.mock.calls[0][0].body).toContain('"reference": "one"');
    await runHttpAssistantTool(db(), ctx, name, { reference: 'one' }); expect(h.ask.mock.calls[1][0].dedupeKey).toBe(h.ask.mock.calls[0][0].dedupeKey);
    expect(h.execute).not.toHaveBeenCalled();
  });
  it.each(['GET', 'POST'])('blocks ineligible identity before %s dispatch or proposal', async method => {
    definition().method = method; const ctx = await runtime(); h.identity.mockResolvedValue(false);
    expect(JSON.parse(await runHttpAssistantTool(db(), ctx, ctx.tools[0].tool.name, { reference: 'one' })).ok).toBe(false);
    expect(h.ask).not.toHaveBeenCalled(); expect(h.execute).not.toHaveBeenCalled(); expect(h.writable).not.toHaveBeenCalled();
  });
  it('does not promise notification and refuses read-only or unrecorded proposals', async () => {
    definition().method = 'POST'; const ctx = await runtime(), name = ctx.tools[0].tool.name;
    h.ask.mockResolvedValue({ ok: true, notified: false, approvalId: RUN });
    expect(JSON.parse(await runHttpAssistantTool(db(), ctx, name, { reference: 'one' }))).toMatchObject({ notified: false, confirmed: false });
    h.writable.mockRejectedValue(new Error('subscription_read_only')); h.ask.mockClear();
    expect(JSON.parse(await runHttpAssistantTool(db(), ctx, name, { reference: 'one' })).ok).toBe(false); expect(h.ask).not.toHaveBeenCalled();
  });
  it('creates a separate frozen proposal when bound identity changes instead of overwriting the prior decision', async () => {
    definition().method = 'POST'; const ctx = await runtime(), name = ctx.tools[0].tool.name;
    await runHttpAssistantTool(db(), ctx, name, { reference: 'one' });
    h.bindings.mockResolvedValue({ contact_id: CONTACT, conversation_id: CONV, phone: '+19999999999', email: null });
    await runHttpAssistantTool(db(), ctx, name, { reference: 'one' });
    expect(h.ask.mock.calls[1][0].dedupeKey).not.toBe(h.ask.mock.calls[0][0].dedupeKey);
    expect(h.ask.mock.calls[1][0].payload.http_action_context.phone).toBe('+19999999999');
  });
  it('writes the approval in the business owner language while replying to the customer in the agent language', async () => {
    definition().method = 'POST'; h.merchantLocale = 'en'; const ctx = await runtime();
    const result = JSON.parse(await runHttpAssistantTool(db(), ctx, ctx.tools[0].tool.name, { reference: 'one' }));
    expect(h.ask.mock.calls[0][0].title).toContain('Review action'); expect(result.message).toContain('Solicitud guardada');
  });
  it.each(['claimed', 'blocked', 'uncertain'])('does not claim completion for receipt state %s', async state => {
    const ctx = await runtime(); h.execute.mockResolvedValue({ id: RUN, state, result: null });
    expect(JSON.parse(await runHttpAssistantTool(db(), ctx, ctx.tools[0].tool.name, { reference: 'one' }))).toMatchObject({ ok: false, confirmed: false, status: state });
  });
  it.each(['es', 'en'] as const)('blocks every simulated request and approval before any read (%s)', async locale => {
    expect(JSON.parse(await runHttpAssistantTool(db(), null, 'http_action_any', {}, true, locale))).toMatchObject({ ok: false, simulado: true, confirmed: false });
    expect(reads).toEqual([]); expect(h.execute).not.toHaveBeenCalled(); expect(h.ask).not.toHaveBeenCalled(); expect(h.bindings).not.toHaveBeenCalled();
  });
  it('sanitizes database exceptions and never accepts a model tool-block ID as inbound provenance', async () => {
    const ctx = await runtime();
    expect(JSON.parse(await runHttpAssistantTool(db(), { ...ctx, inboundId: 'toolu_model_generated' }, ctx.tools[0].tool.name, { reference: 'one' })).ok).toBe(false);
    h.access.mockRejectedValue(new Error('PRIVATE_DB')); const result = await runHttpAssistantTool(db(), ctx, ctx.tools[0].tool.name, { reference: 'one' });
    expect(JSON.parse(result).ok).toBe(false); expect(result).not.toContain('PRIVATE_DB'); expect(h.execute).not.toHaveBeenCalled();
  });
});
