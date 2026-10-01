import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
const h = vi.hoisted(() => ({ visible: true, access: vi.fn(), load: vi.fn(), credential: vi.fn(), identity: vi.fn(), transport: vi.fn() }));
vi.mock('@/lib/ui/improvements-preview', () => ({ get SHOW_RIVERZ_IMPROVEMENTS() { return h.visible; } }));
vi.mock('@/lib/mcp/access', () => ({ userAccess: h.access }));
vi.mock('./http-action-store', async original => ({ ...await original<typeof import('./http-action-store')>(), loadHttpAction: h.load }));
vi.mock('./http-assistant-identity', () => ({ httpAssistantIdentityAllowed: h.identity }));
vi.mock('./http-action-credentials', () => ({ openHttpCredential: h.credential }));
vi.mock('@/lib/security/public-json-request', async original => ({ ...await original<typeof import('@/lib/security/public-json-request')>(), requestPublicJson: h.transport }));
import { PublicJsonError } from '@/lib/security/public-json-request';
import { executeHttpAction, executeHttpAssistantAction } from './http-action-executor';
const WS = '11111111-1111-4111-8111-111111111111', ACTOR = '22222222-2222-4222-8222-222222222222';
const ID = '33333333-3333-4333-8333-333333333333', RUN = '44444444-4444-4444-8444-444444444444';
const LEASE = '55555555-5555-4555-8555-555555555555', CONV = '66666666-6666-4666-8666-666666666666';
const CONTACT = '77777777-7777-4777-8777-777777777777', CONN = '88888888-8888-4888-8888-888888888888';
const ctx = () => ({ workspaceId: WS, actorUserId: ACTOR, actionId: ID, expectedRevision: 2, invocationKey: 'a'.repeat(64), confirmed: false });
const definition = () => ({ name: 'Configured action', description: 'Read status', method: 'GET', url: 'https://integration.test/status', credential_kind: 'bearer',
  parameters: [{ key: 'order_id', type: 'string', required: true }], outputs: [{ key: 'status', type: 'string', path: ['result', 'status'], required: true }] });
const ack = () => ({ id: RUN, state: 'acknowledged', status_code: 200, error_code: null, result: { status: 'received' } });
let rpc = vi.fn(), reads: Record<string, { data: unknown; error: unknown }>, filters: Array<[string, string, unknown]>;
function db(): SupabaseClient {
  return { rpc, from: (table: string) => {
    const q = { select: () => q, eq: (field: string, value: unknown) => { filters.push([table, field, value]); return q; },
      is: (field: string, value: unknown) => { filters.push([table, field, value]); return q; }, maybeSingle: async () => reads[table] }; return q;
  } } as unknown as SupabaseClient;
}
beforeEach(() => {
  vi.clearAllMocks(); h.visible = true; filters = [];
  h.identity.mockResolvedValue(true); h.access.mockResolvedValue({ admin: true, sections: null });
  h.load.mockResolvedValue({ id: ID, workspace_id: WS, definition: definition(), state: 'active', revision: 2, credential_ciphertext: 'sealed' });
  h.credential.mockReturnValue({ kind: 'bearer', value: 'fixture-secret' });
  h.transport.mockResolvedValue({ status: 200, data: { result: { status: 'received' }, private_trace: 'PRIVATE_PROVIDER_DATA' } });
  rpc = vi.fn().mockImplementation(async (name: string, args: Record<string, unknown>) => ({ error: null, data: name === 'claim_http_action'
    ? { claimed: true, id: RUN, state: 'claimed', lease_id: LEASE }
    : { id: RUN, state: args.p_state, status_code: args.p_status_code, error_code: args.p_error_code, result: args.p_result } }));
  reads = { conversations: { data: { id: CONV, workspace_id: WS, contact_id: CONTACT, channel: 'whatsapp', connection_id: CONN }, error: null },
    contacts: { data: { id: CONTACT, workspace_id: WS, phone: '+10000000000', email: null }, error: null },
    channel_connections: { data: { id: CONN }, error: null } };
});
describe('HTTP executor receipt boundary', () => {
  it('does no work when comparison is disabled', async () => {
    h.visible = false; await expect(executeHttpAction(db(), ctx(), {})).rejects.toThrow('http_execution_not_found');
    expect(h.access).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled(); expect(h.transport).not.toHaveBeenCalled();
  });
  it('claims before dispatch and exposes only selected fields after confirming the receipt', async () => {
    const result = await executeHttpAction(db(), ctx(), { order_id: 'order-fixture' }); expect(result).toEqual({ ...ack(), cached: false });
    expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(h.transport.mock.invocationCallOrder[0]);
    expect(h.transport.mock.invocationCallOrder[0]).toBeLessThan(rpc.mock.invocationCallOrder[1]);
    expect(rpc.mock.calls[0]).toEqual(['claim_http_action', expect.objectContaining({ p_workspace_id: WS, p_actor_id: ACTOR,
      p_action_id: ID, p_revision: 2, p_input_hash: expect.stringMatching(/^[0-9a-f]{64}$/), p_invocation_key: ctx().invocationKey })]);
    expect(JSON.stringify(rpc.mock.calls)).not.toMatch(/order-fixture|fixture-secret|PRIVATE_PROVIDER/);
    expect(JSON.stringify(result)).not.toMatch(/sealed|lease|fixture-secret|PRIVATE_PROVIDER/);
  });
  it.each(['claimed', 'acknowledged', 'blocked', 'uncertain'])('never sends again when saved state is %s', async state => {
    const saved = state === 'acknowledged' ? ack() : { id: RUN, state, status_code: null, error_code: state === 'claimed' ? null : 'http_timeout', result: null };
    rpc.mockResolvedValue({ error: null, data: { claimed: false, ...saved } });
    expect(await executeHttpAction(db(), ctx(), { order_id: 'one' })).toEqual({ ...saved, cached: true });
    expect(h.credential).not.toHaveBeenCalled(); expect(h.transport).not.toHaveBeenCalled(); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it.each([['http_execution_review_required', 'review_required'], ['http_action_changed', 'changed'], ['subscription_read_only', 'read_only'],
    ['PRIVATE_SQL_ERROR', 'unavailable']])('does not dispatch after claim failure %s', async (message, code) => {
    rpc.mockResolvedValue({ data: null, error: { message } });
    await expect(executeHttpAction(db(), ctx(), { order_id: 'one' })).rejects.toThrow(`http_execution_${code}`);
    expect(h.transport).not.toHaveBeenCalled();
  });
  it.each([null, { admin: true, sections: [] }])('denies stale membership or missing section before configuration reads', async access => {
    h.access.mockResolvedValue(access); await expect(executeHttpAction(db(), ctx(), {})).rejects.toThrow('http_execution_forbidden');
    expect(h.load).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
  });
  it('requires an administrator and server confirmation for POST', async () => {
    h.load.mockResolvedValue({ definition: { ...definition(), method: 'POST' }, state: 'active', revision: 2 });
    await expect(executeHttpAction(db(), ctx(), { order_id: 'one' })).rejects.toThrow('http_execution_confirmation_required');
    h.access.mockResolvedValue({ admin: false, sections: null });
    await expect(executeHttpAction(db(), { ...ctx(), confirmed: true }, { order_id: 'one' })).rejects.toThrow('http_execution_confirmation_required');
    expect(rpc).not.toHaveBeenCalled();
  });
  it('binds identity from current scoped records and passes its exact snapshot to SQL', async () => {
    h.load.mockResolvedValue({ definition: { ...definition(), parameters: [{ key: 'customer', source: 'contact_id', type: 'string', required: true },
      { key: 'phone', source: 'phone', type: 'string', required: true }] }, state: 'active', revision: 2, credential_ciphertext: 'sealed' });
    await executeHttpAction(db(), { ...ctx(), conversationId: CONV }, {});
    expect(h.transport.mock.calls[0][0].url).toContain(`customer=${CONTACT}`);
    expect(rpc.mock.calls[0][1].p_context).toEqual({ contact_id: CONTACT, conversation_id: CONV, phone: '+10000000000', email: null });
    expect(filters).toContainEqual(['conversations', 'workspace_id', WS]); expect(filters).toContainEqual(['contacts', 'workspace_id', WS]);
    await expect(executeHttpAction(db(), { ...ctx(), conversationId: CONV }, { customer: ACTOR })).rejects.toThrow('http_execution_invalid');
    expect(h.transport).toHaveBeenCalledTimes(1);
  });
  it('requires inbox access for a conversation', async () => {
    h.access.mockResolvedValue({ admin: true, sections: ['/automatizaciones'] });
    await expect(executeHttpAction(db(), { ...ctx(), conversationId: CONV }, {})).rejects.toThrow('http_execution_forbidden');
    expect(filters).toEqual([]);
  });
  it.each(['foreign-contact', 'foreign-conversation', 'read-failure', 'foreign-mailbox'])('blocks %s before claiming', async mode => {
    if (mode === 'foreign-contact') reads.contacts.data = { ...(reads.contacts.data as object), workspace_id: ID };
    else if (mode === 'foreign-conversation') reads.conversations.data = { ...(reads.conversations.data as object), workspace_id: ID };
    else if (mode === 'read-failure') reads.contacts.error = { message: 'PRIVATE_SQL' };
    else { reads.conversations.data = { ...(reads.conversations.data as object), channel: 'gmail' }; reads.channel_connections.data = null; }
    await expect(executeHttpAction(db(), { ...ctx(), conversationId: CONV }, { order_id: 'one' })).rejects.toThrow(/^http_execution_(not_found|unavailable)$/);
    expect(rpc).not.toHaveBeenCalled(); expect(h.transport).not.toHaveBeenCalled();
    if (mode === 'foreign-mailbox') expect(filters).toContainEqual(['channel_connections', 'created_by', ACTOR]);
  });
  it('records missing credentials as blocked without sending or storing the private error', async () => {
    h.credential.mockImplementation(() => { throw new Error('PRIVATE_SECRET'); });
    expect(await executeHttpAction(db(), ctx(), { order_id: 'one' })).toMatchObject({ state: 'blocked', error_code: 'http_action_credential_unavailable' });
    expect(h.transport).not.toHaveBeenCalled(); expect(JSON.stringify(rpc.mock.calls)).not.toContain('PRIVATE_SECRET');
  });
  it.each([false, true])('classifies transport failure with dispatched=%s', async dispatched => {
    h.transport.mockRejectedValue(new PublicJsonError('http_timeout', dispatched));
    expect(await executeHttpAction(db(), ctx(), { order_id: 'one' })).toMatchObject({ state: dispatched ? 'uncertain' : 'blocked', result: null, error_code: 'http_timeout' });
    expect(h.transport).toHaveBeenCalledTimes(1);
  });
  it.each(['unknown', 'invalid-output', 'secret-echo'])('records %s after dispatch as uncertain without raw data', async mode => {
    if (mode === 'unknown') h.transport.mockRejectedValue(new Error('PRIVATE_PROVIDER_ERROR'));
    else h.transport.mockResolvedValue({ status: 200, data: { result: { status: mode === 'secret-echo' ? 'fixture-secret' : 12 } } });
    expect(await executeHttpAction(db(), ctx(), { order_id: 'one' })).toMatchObject({ state: 'uncertain', result: null });
    expect(JSON.stringify(rpc.mock.calls)).not.toMatch(/PRIVATE_PROVIDER|fixture-secret/);
  });
  it('does not return provider data when final receipt persistence fails', async () => {
    rpc.mockImplementation(async (name: string) => name === 'claim_http_action'
      ? { data: { claimed: true, id: RUN, state: 'claimed', lease_id: LEASE }, error: null }
      : { data: null, error: { message: 'PRIVATE_STORAGE_ERROR' } });
    await expect(executeHttpAction(db(), ctx(), { order_id: 'one' })).rejects.toThrow('http_execution_unavailable');
    expect(h.transport).toHaveBeenCalledTimes(1);
  });
  it('sanitizes rejected database promises without dispatch or private error text', async () => {
    rpc.mockRejectedValue(new Error('PRIVATE_DATABASE_EXCEPTION'));
    await expect(executeHttpAction(db(), ctx(), { order_id: 'one' })).rejects.toThrow('http_execution_unavailable');
    expect(h.transport).not.toHaveBeenCalled();
  });
  it('accepts the same confirmed selected fields regardless of JSONB property order', async () => {
    h.load.mockResolvedValue({ definition: { ...definition(), outputs: [
      { key: 'zeta', type: 'string', path: ['result', 'status'], required: true },
      { key: 'alpha', type: 'string', path: ['result', 'status'], required: true }] }, state: 'active', revision: 2, credential_ciphertext: 'sealed' });
    rpc.mockImplementation(async (name: string) => ({ error: null, data: name === 'claim_http_action'
      ? { claimed: true, id: RUN, state: 'claimed', lease_id: LEASE }
      : { ...ack(), result: { alpha: 'received', zeta: 'received' } } }));
    expect(await executeHttpAction(db(), ctx(), { order_id: 'one' })).toMatchObject({ state: 'acknowledged', result: { zeta: 'received', alpha: 'received' } });
  });
  it.each(['mismatched-id', 'mismatched-result', 'unexpected-field'])('rejects malformed final receipts: %s', async mode => {
    rpc.mockImplementation(async (name: string) => ({ error: null, data: name === 'claim_http_action'
      ? { claimed: true, id: RUN, state: 'claimed', lease_id: LEASE }
      : mode === 'mismatched-id' ? { ...ack(), id: CONV } : mode === 'mismatched-result'
        ? { ...ack(), result: { status: 'not-confirmed' } } : { ...ack(), raw_secret: 'PRIVATE' } }));
    await expect(executeHttpAction(db(), ctx(), { order_id: 'one' })).rejects.toThrow('http_execution_unavailable');
  });
  it('rejects undeclared replay fields instead of exposing a stored raw response', async () => {
    rpc.mockResolvedValue({ error: null, data: { claimed: false, ...ack(), result: { status: 'received', private_data: 'PRIVATE' } } });
    await expect(executeHttpAction(db(), ctx(), { order_id: 'one' })).rejects.toThrow('http_execution_unavailable'); expect(h.transport).not.toHaveBeenCalled();
  });
  it('keeps the provider idempotency key stable for equivalent validated arguments', async () => {
    await executeHttpAction(db(), ctx(), { order_id: 'one' }); const first = h.transport.mock.calls[0][0].idempotencyKey;
    await executeHttpAction(db(), ctx(), { order_id: 'one' }); expect(h.transport.mock.calls[1][0].idempotencyKey).toBe(first);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });
});

const AGENT = '99999999-9999-4999-8999-999999999999';
const assistant = () => ({ workspaceId: WS, actionId: ID, expectedRevision: 2, invocationKey: 'a'.repeat(64),
  agentId: AGENT, conversationId: CONV, grantRevision: 1, channel: 'whatsapp' as const });
describe('assistant HTTP gateway', () => {
  beforeEach(() => {
    reads.http_action_assistant_grants = { data: { workspace_id: WS, action_id: ID, agent_id: AGENT, channel: 'whatsapp',
      context_scope: 'contact', action_revision: 2, revision: 1, state: 'active', granted_by: ACTOR }, error: null };
    h.load.mockResolvedValue({ id: ID, workspace_id: WS, definition: { ...definition(), parameters: [
      { key: 'customer', type: 'string', source: 'contact_id', required: true }, { key: 'order_id', type: 'string', required: true }] },
    state: 'active', revision: 2, credential_ciphertext: 'sealed' });
    rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => ({ error: null, data: name === 'claim_http_action_assistant'
      ? { claimed: true, id: RUN, state: 'claimed', lease_id: LEASE }
      : { id: RUN, state: args.p_state, status_code: args.p_status_code, error_code: args.p_error_code, result: args.p_result } }));
  });
  it('stays inactive before configuration, authority or context reads in normal production mode', async () => {
    h.visible = false; await expect(executeHttpAssistantAction(db(), assistant(), {})).rejects.toThrow('http_execution_not_found');
    expect(filters).toEqual([]); expect(h.access).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
  });
  it('claims as the assistant using its own RPC, protected grant version and server-bound customer identity', async () => {
    expect(await executeHttpAssistantAction(db(), assistant(), { order_id: 'one' })).toEqual({ ...ack(), cached: false });
    expect(rpc.mock.calls[0]).toEqual(['claim_http_action_assistant', expect.objectContaining({ p_agent_id: AGENT,
      p_workspace_id: WS, p_action_id: ID, p_revision: 2, p_channel: 'whatsapp', p_grant_revision: 1,
      p_parameters: { order_id: 'one' }, p_context: { contact_id: CONTACT, conversation_id: CONV, phone: '+10000000000', email: null },
      p_approval_id: null, p_approval_actor_id: null })]);
    expect(rpc.mock.calls[0][1]).not.toHaveProperty('p_actor_id');
    expect(filters).toContainEqual(['http_action_assistant_grants', 'workspace_id', WS]);
    expect(filters).toContainEqual(['http_action_assistant_grants', 'agent_id', AGENT]);
    expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(h.transport.mock.invocationCallOrder[0]);
    expect(JSON.stringify(rpc.mock.calls)).not.toMatch(/fixture-secret|PRIVATE_PROVIDER/);
  });
  it.each(['foreign', 'withdrawn', 'revision', 'action-version', 'missing'])('denies %s grants before dispatch', async mode => {
    const grant = reads.http_action_assistant_grants.data as Record<string, unknown>;
    if (mode === 'foreign') grant.workspace_id = ID;
    if (mode === 'withdrawn') grant.state = 'withdrawn';
    if (mode === 'revision') grant.revision = 2;
    if (mode === 'action-version') grant.action_revision = 1;
    if (mode === 'missing') reads.http_action_assistant_grants.data = null;
    await expect(executeHttpAssistantAction(db(), assistant(), { order_id: 'one' })).rejects.toThrow(/^http_execution_(forbidden|changed)$/);
    expect(h.load).not.toHaveBeenCalled(); expect(h.transport).not.toHaveBeenCalled();
  });
  it.each([null, { admin: false, sections: null }, { admin: true, sections: ['/automatizaciones', '/bandeja'] }])('requires current grantor administration and configuration access', async access => {
    h.access.mockResolvedValue(access);
    await expect(executeHttpAssistantAction(db(), assistant(), { order_id: 'one' })).rejects.toThrow('http_execution_forbidden');
    expect(h.load).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
  });
  it('requires an exact current channel and rejects model-supplied bound identity or authority fields', async () => {
    reads.conversations.data = { ...(reads.conversations.data as object), channel: 'gmail' };
    await expect(executeHttpAssistantAction(db(), assistant(), { order_id: 'one' })).rejects.toThrow('http_execution_not_found');
    reads.conversations.data = { ...(reads.conversations.data as object), channel: 'whatsapp' };
    await expect(executeHttpAssistantAction(db(), assistant(), { order_id: 'one', customer: ACTOR })).rejects.toThrow('http_execution_invalid');
    await expect(executeHttpAssistantAction(db(), { ...assistant(), confirmed: true } as ReturnType<typeof assistant>, { order_id: 'one' })).rejects.toThrow('http_execution_invalid');
    expect(rpc).not.toHaveBeenCalled();
  });
  it('enforces business-only GET without model parameters and contact-bound customer lookups', async () => {
    const grant = reads.http_action_assistant_grants.data as Record<string, unknown>;
    grant.context_scope = 'business';
    await expect(executeHttpAssistantAction(db(), assistant(), { order_id: 'one' })).rejects.toThrow('http_execution_forbidden');
    h.load.mockResolvedValue({ definition: { ...definition(), parameters: [] }, state: 'active', revision: 2, credential_ciphertext: 'sealed' });
    expect(await executeHttpAssistantAction(db(), assistant(), {})).toMatchObject({ state: 'acknowledged' });
    grant.context_scope = 'contact';
    await expect(executeHttpAssistantAction(db(), assistant(), {})).rejects.toThrow('http_execution_forbidden');
    expect(h.transport).toHaveBeenCalledTimes(1);
  });
  it('requires protected POST approval identities and lets SQL validate the exact saved human decision', async () => {
    const action = await h.load(); h.load.mockResolvedValue({ ...action, definition: { ...action.definition, method: 'POST' } });
    await expect(executeHttpAssistantAction(db(), assistant(), { order_id: 'one' })).rejects.toThrow('http_execution_confirmation_required');
    rpc.mockResolvedValue({ data: null, error: { message: 'http_execution_confirmation_required' } });
    await expect(executeHttpAssistantAction(db(), { ...assistant(), approvalId: LEASE, approvalActorId: ACTOR }, { order_id: 'one' }))
      .rejects.toThrow('http_execution_confirmation_required');
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_approval_id: LEASE, p_approval_actor_id: ACTOR }); expect(h.transport).not.toHaveBeenCalled();
  });
  it('rechecks identity eligibility before claiming even an approved request', async () => {
    const action = await h.load(); h.load.mockResolvedValue({ ...action, definition: { ...action.definition, method: 'POST' } });
    h.identity.mockResolvedValue(false);
    await expect(executeHttpAssistantAction(db(), { ...assistant(), approvalId: LEASE, approvalActorId: ACTOR }, { order_id: 'one' }))
      .rejects.toThrow('http_execution_forbidden');
    expect(rpc).not.toHaveBeenCalled(); expect(h.credential).not.toHaveBeenCalled(); expect(h.transport).not.toHaveBeenCalled();
  });
  it('checks a different current approver separately from the grantor', async () => {
    const action = await h.load(); h.load.mockResolvedValue({ ...action, definition: { ...action.definition, method: 'POST' } });
    h.access.mockImplementation(async (_db, actor) => actor === ACTOR ? { admin: true, sections: null } : { admin: false, sections: null });
    await expect(executeHttpAssistantAction(db(), { ...assistant(), approvalId: LEASE, approvalActorId: CONTACT }, { order_id: 'one' }))
      .rejects.toThrow('http_execution_forbidden');
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each(['claimed', 'acknowledged', 'blocked', 'uncertain'])('never redispatches an assistant receipt in state %s', async state => {
    const saved = state === 'acknowledged' ? ack() : { id: RUN, state, status_code: null, error_code: state === 'claimed' ? null : 'http_timeout', result: null };
    rpc.mockResolvedValue({ data: { claimed: false, ...saved }, error: null });
    expect(await executeHttpAssistantAction(db(), assistant(), { order_id: 'one' })).toEqual({ ...saved, cached: true });
    expect(h.credential).not.toHaveBeenCalled(); expect(h.transport).not.toHaveBeenCalled();
  });
  it('sanitizes persistence rejection after dispatch without returning provider data or retrying', async () => {
    rpc.mockImplementation(async (name: string) => {
      if (name === 'claim_http_action_assistant') return { data: { claimed: true, id: RUN, state: 'claimed', lease_id: LEASE }, error: null };
      throw new Error('PRIVATE_STORAGE');
    });
    await expect(executeHttpAssistantAction(db(), assistant(), { order_id: 'one' })).rejects.toThrow('http_execution_unavailable');
    expect(h.transport).toHaveBeenCalledTimes(1);
  });
});
