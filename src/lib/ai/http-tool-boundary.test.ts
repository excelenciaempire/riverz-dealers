import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
const h = vi.hoisted(() => ({ run: vi.fn(), trace: vi.fn() }));
vi.mock('./http-actions', () => ({ isHttpAssistantTool: (name: string) => name.startsWith('http_action_'), runHttpAssistantTool: h.run }));
vi.mock('@/lib/observability/latitude', async original => ({ ...await original<typeof import('@/lib/observability/latitude')>(), traceTool: h.trace }));
import { runTool, runWithTools, type LocalOrdersContext } from './tools';
const name = 'http_action_33333333333343338333333333333333_v2';
function context(method: 'GET' | 'POST'): LocalOrdersContext {
  return { db: {} as SupabaseClient, workspaceId: 'own', contactId: 'contact',
    httpActions: { scope: { workspaceId: 'own', agentId: 'agent', channel: 'whatsapp', locale: 'es', conversationId: 'conversation', contactId: 'contact' },
      inboundId: 'inbound', tools: [{ actionId: 'action', actionRevision: 2, grantRevision: 1, method,
        tool: { name, description: 'Configured fixture', input_schema: { type: 'object', properties: {}, additionalProperties: false } } }] } };
}
beforeEach(() => {
  vi.clearAllMocks(); h.run.mockResolvedValue(JSON.stringify({ ok: true, estado: 'pendiente_de_aprobacion', confirmed: false }));
  h.trace.mockImplementation((_name, work) => work());
});
describe('HTTP integration in the existing assistant tool loop', () => {
  it('routes custom calls to the protected runtime without individual tool input/result tracing', async () => {
    const ctx = context('POST'); await runTool(name, { private_input: 'fixture' }, null, null, ctx);
    expect(h.run).toHaveBeenCalledWith(ctx.db, ctx.httpActions, name, { private_input: 'fixture' }, false, undefined);
    expect(h.trace).not.toHaveBeenCalled();
    expect(JSON.parse(await runTool(name, {}, null)).ok).toBe(false); expect(h.run).toHaveBeenCalledTimes(1);
  });
  it.each(['GET', 'POST'] as const)('passes the simulation boundary before custom %s dispatch or generic approval logic', async method => {
    const ctx = { ...context(method), simulacion: true, requiereAprobacion: [name], httpSimulationLocale: 'en' as const };
    await runTool(name, {}, null, null, ctx);
    expect(h.run).toHaveBeenCalledWith(ctx.db, ctx.httpActions, name, {}, true, 'en');
  });
  it.each([['GET', 0], ['POST', 1]] as const)('counts %s effects before the next model call can fail', async (method, count) => {
    const ctx = context(method), effects = { ejecutados: 0 };
    const create = vi.fn().mockResolvedValueOnce({ stop_reason: 'tool_use', usage: {}, content: [{ type: 'tool_use', id: 'model_block_not_a_receipt_key', name, input: {} }] })
      .mockRejectedValueOnce(new Error('fixture credential rejected'));
    const client = { messages: { create } } as unknown as Anthropic;
    await expect(runWithTools(client, { model: 'claude-sonnet-5-5', max_tokens: 100, system: 'Fixture',
      messages: [{ role: 'user', content: 'Fixture' }], tools: ctx.httpActions!.tools.map(tool => tool.tool), shopify: null,
      localOrders: ctx, efectos: effects })).rejects.toThrow('fixture credential rejected');
    expect(h.run).toHaveBeenCalledTimes(1); expect(effects.ejecutados).toBe(count);
  });
  it('rejects an unoffered dynamic tool before runtime dispatch or effect counting', async () => {
    const effects = { ejecutados: 0 };
    const create = vi.fn().mockResolvedValueOnce({ stop_reason: 'tool_use', usage: {}, content: [{ type: 'tool_use', id: 'unoffered', name, input: {} }] })
      .mockResolvedValueOnce({ stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: 'Fixture response' }] });
    await runWithTools({ messages: { create } } as unknown as Anthropic, { model: 'claude-sonnet-5-5', max_tokens: 100,
      system: 'Fixture', messages: [{ role: 'user', content: 'Fixture' }], tools: [], shopify: null, localOrders: context('POST'), efectos: effects });
    expect(h.run).not.toHaveBeenCalled(); expect(effects.ejecutados).toBe(0);
  });
});
