import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpActor } from '@/lib/mcp/tokens';
const h = vi.hoisted(() => ({ actor: null as McpActor | null, run: vi.fn(), preview: vi.fn(), audit: vi.fn(), writable: vi.fn() }));
vi.mock('@/lib/mcp/tokens', async original => ({ ...await original<typeof import('@/lib/mcp/tokens')>(), resolveActor: async () => h.actor }));
vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: () => ({ from: () => ({ insert: h.audit }) }) }));
vi.mock('@/lib/rate-limit', () => ({ limitByKey: async () => ({ success: true }) }));
vi.mock('@/lib/billing/read-only', () => ({ assertWorkspaceWritable: h.writable }));
vi.mock('@/lib/mcp/oauth', () => ({ issuer: () => 'https://riverz.test' }));
vi.mock('@/lib/mcp/verification', () => ({ verifyConnection: vi.fn() }));
vi.mock('@/lib/mcp/registry', () => {
  const tools = [{ name: 'http_accion_ejecutar', capabilityKey: 'integraciones.http_ejecutar', risk: 'irreversible',
    description: 'Execute a configured HTTP action after confirmation', schema: { type: 'object', properties: {} }, run: h.run, preview: h.preview },
  { name: 'http_accion_consultar', capabilityKey: 'integraciones.http_consultar', risk: 'lectura',
    description: 'Read a configured HTTP action', schema: { type: 'object', properties: {} }, run: h.run }];
  return { ALL_TOOLS: tools, findTool: (name: string) => tools.find(t => t.name === name) };
});
import { POST } from './route';
const WS = '11111111-1111-4111-8111-111111111111', USER = '22222222-2222-4222-8222-222222222222';
const ID = '33333333-3333-4333-8333-333333333333', RECEIPT = '44444444-4444-4444-8444-444444444444';
const actor = (): McpActor => ({ kind: 'workspace', workspaceId: WS, tokenId: 'key-one', userId: USER, label: 'key', scope: 'total', origin: 'manual' });
const args = () => ({ action_id: ID, expected_revision: 2, parameters: { phone: 'PRIVATE_PHONE', contents: 'PRIVATE_PAYLOAD' } });
async function call(arguments_: Record<string, unknown>, name = 'http_accion_ejecutar') {
  const response = await POST(new Request('https://riverz.test/api/mcp', { method: 'POST', headers: { authorization: 'Bearer fixture-key', 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: arguments_ } }) }));
  return response.json();
}
async function confirmation() {
  const body = await call(args()); const token = body.result.content[0].text.match(/confirm_token: ([^\s]+)/)?.[1];
  expect(token).toBeTruthy(); return String(token);
}
beforeEach(() => {
  vi.clearAllMocks(); h.actor = actor(); h.preview.mockResolvedValue('Review the protected HTTP action');
  h.run.mockResolvedValue({ receipt_id: RECEIPT, state: 'acknowledged', data: { phone: 'PRIVATE_RESULT' } });
  h.audit.mockResolvedValue({ error: null }); h.writable.mockResolvedValue(undefined);
});
describe('HTTP MCP protected confirmations and audit', () => {
  it('previews without dispatch and uses a stable server key when that confirmation is replayed', async () => {
    const token = await confirmation(); expect(h.run).not.toHaveBeenCalled();
    await call({ ...args(), confirm_token: token }); await call({ ...args(), confirm_token: token });
    expect(h.run).toHaveBeenCalledTimes(2);
    expect(h.run.mock.calls[0][1]).toMatchObject({ userId: USER, httpExecution: { confirmed: true, invocationKey: expect.stringMatching(/^[0-9a-f]{64}$/) } });
    expect(h.run.mock.calls[0][1].httpExecution.invocationKey).toBe(h.run.mock.calls[1][1].httpExecution.invocationKey);
    // The executor's durable claim enforces the no-redispatch boundary; this test proves the adapter preserves its key.
  });
  it('rejects a token copied to another key of the same user', async () => {
    const token = await confirmation(); h.actor = { ...actor(), tokenId: 'key-two' } as McpActor;
    await call({ ...args(), confirm_token: token }); expect(h.run).not.toHaveBeenCalled(); expect(h.preview).toHaveBeenCalledTimes(2);
  });
  it.each(['suffix', 'changed-arguments', 'expired'])('rejects %s confirmation instead of deriving a new dispatch key', async mode => {
    const token = await confirmation();
    await call({ ...args(), ...(mode === 'changed-arguments' ? { expected_revision: 3 } : {}),
      confirm_token: mode === 'suffix' ? `${token}.extra` : mode === 'expired' ? `1000000000000.${token.split('.')[1]}` : token });
    expect(h.run).not.toHaveBeenCalled();
  });
  it.each(['platform', 'issuerless', 'read-only'])('denies %s POST callers before preview', async mode => {
    h.actor = mode === 'platform' ? { kind: 'platform', label: 'platform', scope: 'total' }
      : { ...actor(), ...(mode === 'issuerless' ? { userId: null } : { scope: 'lectura' }) } as McpActor;
    const body = await call(args()); expect(body.error.code).toBe(-32003); expect(h.run).not.toHaveBeenCalled(); expect(h.preview).not.toHaveBeenCalled();
  });
  it('drops provider parameters and selected data from platform audit on preview, execution and failure', async () => {
    const token = await confirmation(); await call({ ...args(), confirm_token: token });
    h.run.mockRejectedValue(new Error('The result needs review.')); await call({ ...args(), confirm_token: token });
    const audit = JSON.stringify(h.audit.mock.calls); expect(audit).not.toMatch(/PRIVATE_PHONE|PRIVATE_PAYLOAD|PRIVATE_RESULT|confirm_token/);
    expect(audit).toContain(ID); expect(audit).toContain(`http_acknowledged:${RECEIPT}`);
  });
  it('gives GET fresh invocation keys without accepting a client key', async () => {
    await call({ ...args(), invocation_key: 'FORGED' }, 'http_accion_consultar'); await call(args(), 'http_accion_consultar');
    expect(h.run.mock.calls[0][1].httpExecution.confirmed).toBe(false);
    expect(h.run.mock.calls[0][1].httpExecution.invocationKey).not.toBe(h.run.mock.calls[1][1].httpExecution.invocationKey);
    expect(h.run.mock.calls[0][1].httpExecution.invocationKey).not.toBe('FORGED');
    // Strict capability parsing rejects the unknown argument before executor dispatch.
  });
  it('enforces account scope before issuing a confirmation', async () => {
    expect((await call({ ...args(), workspace_id: USER })).error.code).toBe(-32003); expect(h.preview).not.toHaveBeenCalled();
  });
});
