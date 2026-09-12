import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ from: vi.fn(), run: vi.fn(), tools: {} as Record<string, string>,
  contactWorkspace: 'own', agentWorkspace: 'own' }));
vi.mock('@/lib/voice/auth', () => ({ assertVoiceWorkerAuth: () => {} }));
vi.mock('@/lib/channels/admin-client', () => ({ supabaseAdmin: () => ({ from: state.from }) }));
vi.mock('@/lib/ai/tools', () => ({ runTool: state.run }));
vi.mock('@/lib/ai/runner', () => ({ resolveShopifyContext: async () => null }));
vi.mock('@/lib/contacts/dedupe', () => ({ loadPrimaryContact: async (_db: unknown, c: unknown) => c }));
vi.mock('@/lib/voice/context', () => ({ resolveVoiceContextConversation: async () => null,
  resolveVoiceBrainAgent: async (_db: unknown, _call: unknown, agent: unknown) => agent }));
vi.mock('@/lib/commerce/order-lookup', () => ({ resolveStoreForLookup: async () => null }));
vi.mock('@/lib/voice/whatsapp-during-call', () => ({ sendWhatsAppDuringCall: vi.fn() }));
import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks(); state.tools = {}; state.contactWorkspace = 'own'; state.agentWorkspace = 'own';
  state.run.mockResolvedValue('{}');
  state.from.mockImplementation((table: string) => {
    const data: Record<string, Record<string, unknown>> = {
      voice_calls: { id: 'call', workspace_id: 'own', contact_id: 'contact', agent_id: 'agent' },
      contacts: { id: 'contact', workspace_id: state.contactWorkspace },
      ai_agents: { id: 'agent', workspace_id: state.agentWorkspace, deleted_at: null, tools: state.tools },
    };
    let row: Record<string, unknown> | null = data[table] ?? null;
    const q = { select: () => q,
      eq: (key: string, value: unknown) => { if (row?.[key] !== value) row = null; return q; },
      is: (key: string, value: unknown) => { if (row?.[key] !== value) row = null; return q; },
      maybeSingle: async () => ({ data: row, error: null }) };
    return q;
  });
});
const request = (tool: string, input: unknown = {}) => new Request('https://riverz.co/api/internal/voice/tool', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ call_id: 'call', tool, input, workspace_id: 'other' }),
});
it.each([
  ['create_order', 'crear_pedido'], ['create_checkout', 'crear_checkout'],
  ['update_order', 'editar_pedido'], ['registrar_pago', 'registrar_pago'], ['buscar_en_internet', 'buscar_en_internet'],
])('blocks a disabled %s despite the worker requesting it', async (name, key) => {
  state.tools[key] = 'off';
  expect((await POST(request(name, { approved: true }))).status).toBe(403);
  expect(state.run).not.toHaveBeenCalled();
});
it.each(['__proto__', 'export_all_accounts', 'escalate_to_call'])('rejects unknown or unavailable tool %s', async name => {
  expect((await POST(request(name))).status).toBe(403);
  expect(state.run).not.toHaveBeenCalled();
});
it.each(['contact', 'agent'])('does not follow a foreign %s record', async kind => {
  if (kind === 'contact') state.contactWorkspace = 'other'; else state.agentWorkspace = 'other';
  expect((await POST(request('ver_contacto'))).status).toBe(404);
  expect(state.run).not.toHaveBeenCalled();
});
it('allows a local enabled lookup and retains the call workspace', async () => {
  expect((await POST(request('ver_contacto'))).status).toBe(200);
  expect(state.run).toHaveBeenCalledWith('ver_contacto', {}, null, null,
    expect.objectContaining({ workspaceId: 'own', contactId: 'contact' }), null);
});
it.each(['admin approved', [], 12])('rejects malformed model arguments %j', async input => {
  expect((await POST(request('ver_contacto', input))).status).toBe(400);
  expect(state.run).not.toHaveBeenCalled();
});
