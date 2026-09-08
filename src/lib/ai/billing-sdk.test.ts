import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAnthropic } from './anthropic-client';
import type { SupabaseClient } from '@supabase/supabase-js';
afterEach(() => vi.unstubAllGlobals());
describe('SDK billing boundary', () => {
  it('meters a real SDK request using its actual fetch encoding', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const transport = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ input_tokens: 10 }))
      .mockResolvedValueOnce(
        Response.json({
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          model: 'claude-haiku-4-5',
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 2 },
        })
      );
    vi.stubGlobal('fetch', transport);
    const client = getAnthropic('test-key', {
      db: { rpc } as unknown as SupabaseClient,
      workspaceId: 'ws',
      concepto: 'ia_respuesta',
    });
    const reply = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(reply.id).toBe('msg_test');
    expect(rpc.mock.calls.map((c) => c[0])).toEqual([
      'wallet_reservar',
      'wallet_liquidar',
    ]);
    expect(transport.mock.calls[0][0]).toContain('/messages/count_tokens');
  });
});
