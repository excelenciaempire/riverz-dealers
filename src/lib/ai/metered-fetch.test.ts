import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { meteredAnthropicFetch, anthropicUsageCost } from './metered-fetch';
const params = {
  model: 'claude-haiku-4-5',
  max_tokens: 100,
  messages: [{ role: 'user', content: 'hello' }],
};
function setup(allowed = true, source = 'platform') {
  const rpc = vi.fn().mockImplementation(async (name) => ({
    data: name === 'wallet_reservar' ? allowed : [],
    error: null,
  }));
  const ctx = {
    db: { rpc } as unknown as SupabaseClient,
    workspaceId: 'ws',
    concepto: 'ia_respuesta',
    origenDeLaClave: source,
  };
  return { ctx, rpc };
}
describe('metered Anthropic HTTP boundary', () => {
  it('accounts for different cache durations and actual searches', () => {
    expect(
      anthropicUsageCost('claude-haiku-4-5', {
        input_tokens: 1000,
        output_tokens: 100,
        cache_creation_input_tokens: 2000,
        cache_creation: { ephemeral_1h_input_tokens: 1000 },
        cache_read_input_tokens: 1000,
        server_tool_use: { web_search_requests: 2 },
      })
    ).toBeCloseTo(0.02485);
  });
  it('refuses unknown pricing', () =>
    expect(() => anthropicUsageCost('new-unknown-model', {})).toThrow(
      'wallet_unknown_model_rate'
    ));
  it('does not call the paid endpoint without reserved funds', async () => {
    const { ctx } = setup(false),
      transport = vi
        .fn()
        .mockResolvedValue(Response.json({ input_tokens: 10 }));
    await expect(
      meteredAnthropicFetch(ctx, transport)(
        'https://api.anthropic.com/v1/messages',
        { body: JSON.stringify(params) }
      )
    ).rejects.toThrow('sin_saldo');
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][0]).toContain('count_tokens');
  });
  it('settles before returning an empty/discarded response', async () => {
    const { ctx, rpc } = setup(),
      transport = vi
        .fn()
        .mockResolvedValueOnce(Response.json({ input_tokens: 10 }))
        .mockResolvedValueOnce(
          Response.json({
            id: 'msg1',
            content: [],
            usage: { input_tokens: 10, output_tokens: 50 },
          })
        );
    await meteredAnthropicFetch(ctx, transport)(
      'https://api.anthropic.com/v1/messages',
      { body: JSON.stringify(params) }
    );
    expect(rpc.mock.calls.map((c) => c[0])).toEqual([
      'wallet_reservar',
      'wallet_liquidar',
    ]);
    expect(rpc.mock.calls[1][1].p_costo_centavos).toBeCloseTo(0.026);
  });
  it('never charges an agent-owned key', async () => {
    const { ctx, rpc } = setup(true, 'agent'),
      transport = vi.fn().mockResolvedValue(Response.json({}));
    await meteredAnthropicFetch(ctx, transport)(
      'https://api.anthropic.com/v1/messages',
      { body: JSON.stringify(params) }
    );
    expect(transport).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('releases a definitely rejected request', async () => {
    const { ctx, rpc } = setup(),
      transport = vi
        .fn()
        .mockResolvedValueOnce(Response.json({ input_tokens: 10 }))
        .mockResolvedValueOnce(new Response(null, { status: 400 }));
    await meteredAnthropicFetch(ctx, transport)(
      'https://api.anthropic.com/v1/messages',
      { body: JSON.stringify(params) }
    );
    expect(rpc.mock.calls.map((c) => c[0])).toEqual([
      'wallet_reservar',
      'wallet_cancelar_reserva',
    ]);
  });
  it('retains a reservation if a network timeout leaves billing unknown', async () => {
    const { ctx, rpc } = setup(),
      transport = vi
        .fn()
        .mockResolvedValueOnce(Response.json({ input_tokens: 10 }))
        .mockRejectedValueOnce(new Error('timeout'));
    await expect(
      meteredAnthropicFetch(ctx, transport)(
        'https://api.anthropic.com/v1/messages',
        { body: JSON.stringify(params) }
      )
    ).rejects.toThrow('timeout');
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(['wallet_reservar']);
  });
  it('bills streaming usage when SSE events cross chunk boundaries', async () => {
    const { ctx, rpc } = setup(),
      encoder = new TextEncoder();
    const payload =
      'data: ' +
      JSON.stringify({
        type: 'message_start',
        message: { id: 'msg', usage: { input_tokens: 20, output_tokens: 0 } },
      }) +
      '\n\ndata: ' +
      JSON.stringify({ type: 'message_delta', usage: { output_tokens: 40 } }) +
      '\n\ndata: {"type":"message_stop"}\n\n';
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(encoder.encode(payload.slice(0, 51)));
        c.enqueue(encoder.encode(payload.slice(51)));
        c.close();
      },
    });
    const transport = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ input_tokens: 20 }))
      .mockResolvedValueOnce(new Response(stream));
    const response = await meteredAnthropicFetch(ctx, transport)(
      'https://api.anthropic.com/v1/messages',
      { body: JSON.stringify({ ...params, stream: true }) }
    );
    expect(await response.text()).toBe(payload);
    expect(rpc.mock.calls[1][1].p_costo_centavos).toBeCloseTo(0.022);
  });
});
