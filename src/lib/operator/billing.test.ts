import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getAnthropicStreaming } from '@/lib/ai/anthropic-client'
import { anthropicRunner } from './fleet/runner'
import { exigirMensualidad } from '@/lib/wallet/puerta'
import { NextResponse } from 'next/server'

// These tests isolate streaming wallet accounting. Subscription authorization
// has its own database tests and is represented explicitly here.
vi.mock('@/lib/wallet/puerta', () => ({ exigirMensualidad: vi.fn() }))
beforeEach(() => vi.mocked(exigirMensualidad).mockResolvedValue(null))

afterEach(() => vi.unstubAllGlobals())

function setup(allowed = true) {
  const rpc = vi.fn().mockResolvedValue({ data: allowed, error: null })
  const transport = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes('/count_tokens')) return Response.json({ input_tokens: 20 })
    const events = [
      { type: 'message_start', message: { id: 'msg', type: 'message', role: 'assistant', model: 'claude-haiku-4-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 20, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 40 } },
      { type: 'message_stop' },
    ]
    return new Response(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } })
  })
  vi.stubGlobal('fetch', transport)
  const runner = anthropicRunner(getAnthropicStreaming('test-key', {
    db: { rpc } as unknown as SupabaseClient, workspaceId: 'ws', concepto: 'ia_operador',
  }))
  return { rpc, transport, runner }
}

const call = {
  quien: 'orquestador' as const, model: 'claude-haiku-4-5', system: 'Test',
  messages: [{ role: 'user' as const, content: 'Test' }], tools: [], maxTokens: 100, effort: 'low' as const,
}
describe('Operator SDK streaming billing', () => {
  it('stops before token counting, wallet reservation or generation when monthly access is blocked', async () => {
    vi.mocked(exigirMensualidad).mockResolvedValue(NextResponse.json({ error: 'suscripcion_vencida' }, { status: 402 }))
    const { runner, transport, rpc } = setup()
    await expect(runner(call, () => {})).rejects.toThrow()
    expect(transport).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
  it('reserves and settles each orchestrator and specialist call once', async () => {
    const { rpc, runner } = setup()
    await runner(call, () => {})
    await runner({ ...call, quien: 'plantillas' }, () => {})
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['wallet_reservar', 'wallet_liquidar', 'wallet_reservar', 'wallet_liquidar'])
    const charges = rpc.mock.calls.filter(([name]) => name === 'wallet_liquidar')
    for (const [, args] of charges) {
      expect(args.p_workspace).toBe('ws')
      expect(args.p_concepto).toBe('ia_operador')
      expect(args.p_costo_centavos).toBeCloseTo(0.022)
    }
    expect(charges[0][1].p_id).not.toBe(charges[1][1].p_id)
  })
  it('never starts a paid generation when its reservation is rejected', async () => {
    const { runner, transport, rpc } = setup(false)
    await expect(runner(call, () => {})).rejects.toThrow()
    expect(transport).toHaveBeenCalledTimes(1)
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['wallet_reservar'])
  })
})
