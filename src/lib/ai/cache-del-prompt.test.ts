import { describe, it, expect, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';

/**
 * La caché del prompt del asistente es la de cinco minutos.
 *
 * El prompt lleva datos de cada cliente, así que nunca se comparte entre
 * chats, y la mitad de los chats recibe una sola respuesta. Con la de una hora
 * (2026-09-17 al 29) escribirlo costaba el doble de la entrada y era el 89% de
 * lo que se descontaba del saldo: 4,95 ¢ por respuesta, más que no cachear
 * nada. Volver a la de una hora sólo tiene sentido para un bloque que sí se
 * comparte entre chats.
 */

vi.mock('@/lib/channels/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'update', 'is', 'order', 'limit']) q[m] = () => q;
      q.maybeSingle = async () => ({ data: null, error: null });
      return q;
    },
  }),
}));

import { runWithTools } from './tools';
import { secureSystemPrompt } from './input-security';
import { ttlDeCacheDelAsistente } from '@/lib/admin/cost';

/** Un cliente de Anthropic que contesta texto y guarda lo que se le pidió. */
function clienteQueGuarda() {
  const pedidos: Anthropic.MessageCreateParams[] = [];
  const client = {
    messages: {
      create: async (params: Anthropic.MessageCreateParams) => {
        pedidos.push(params);
        return {
          content: [{ type: 'text', text: 'listo' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        };
      },
    },
  } as unknown as Anthropic;
  return { client, pedidos };
}

const turno = (system: string) => ({
  model: 'claude-sonnet-5-5',
  max_tokens: 256,
  system,
  messages: [{ role: 'user' as const, content: 'hola' }],
  tools: [],
  shopify: null,
});

describe('la caché del prompt del asistente', () => {
  it('es la de cinco minutos y el modelo lee el mismo texto', async () => {
    const system = 'Sos la asistente de la tienda.\n'.repeat(400);
    const { client, pedidos } = clienteQueGuarda();
    await runWithTools(client, turno(system));
    expect(pedidos[0].system).toEqual([
      { type: 'text', text: secureSystemPrompt(system), cache_control: { type: 'ephemeral' } },
    ]);
  });

  it('por debajo del mínimo del proveedor va sin marca', async () => {
    const { client, pedidos } = clienteQueGuarda();
    await runWithTools(client, turno('Sos la asistente de la tienda.'));
    expect(pedidos[0].system).toBe(secureSystemPrompt('Sos la asistente de la tienda.'));
  });
});

describe('ttlDeCacheDelAsistente', () => {
  it('tarifa a una hora sólo lo que salió con esa caché', () => {
    expect(ttlDeCacheDelAsistente('2026-09-16T23:59:59Z')).toBe('5m');
    expect(ttlDeCacheDelAsistente('2026-09-17T00:00:00Z')).toBe('1h');
    expect(ttlDeCacheDelAsistente('2026-09-29T23:59:59Z')).toBe('1h');
    expect(ttlDeCacheDelAsistente('2026-09-30T00:00:00Z')).toBe('5m');
    expect(ttlDeCacheDelAsistente(null)).toBe('5m');
  });
});
