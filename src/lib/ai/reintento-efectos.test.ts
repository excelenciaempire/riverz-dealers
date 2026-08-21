import { describe, it, expect, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';

/**
 * Cuándo se puede volver a empezar, y cuándo ya no.
 *
 * Si la clave de Anthropic del comercio deja de servir a mitad de una
 * respuesta, el runner reintenta con la de la plataforma. El reintento arranca
 * con los mensajes ORIGINALES: sin los resultados de las herramientas que ya
 * corrieron, o sea, reprocesando el mismo mensaje de la clienta desde cero.
 *
 * Eso es inofensivo mientras no se haya hecho nada afuera. Pero la falta de
 * saldo aparece justamente ENTRE una vuelta y la siguiente, así que el caso
 * real es: la primera vuelta creó el pedido en Shopify, la segunda se quedó sin
 * clave, y el reintento crea el segundo pedido. Con `crear_link_de_pago` son
 * dos cobros; con `cancelar_pedido`, dos solicitudes idénticas al comercio, que
 * es exactamente lo que el dedupe de las aprobaciones vino a evitar.
 *
 * `efectos.ejecutados` es lo que el reintento mira antes de decidir.
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

/** Un cliente de Anthropic que pide una herramienta y después contesta texto. */
function clienteQuePide(tool: string) {
  let vuelta = 0;
  return {
    messages: {
      create: async () => {
        vuelta += 1;
        if (vuelta === 1) {
          return {
            content: [{ type: 'tool_use', id: 't1', name: tool, input: {} }],
            stop_reason: 'tool_use',
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        }
        return {
          content: [{ type: 'text', text: 'listo' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        };
      },
    },
  } as unknown as Anthropic;
}

const base = {
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 256,
  system: 's',
  messages: [{ role: 'user' as const, content: 'hola' }],
  tools: [],
  shopify: null,
};

describe('efectos.ejecutados', () => {
  it('cuenta la herramienta que deja algo hecho afuera', async () => {
    const efectos = { ejecutados: 0 };
    await runWithTools(clienteQuePide('crear_link_de_pago'), { ...base, efectos });
    expect(efectos.ejecutados).toBe(1);
  });

  it('no cuenta una consulta, que se puede repetir sin consecuencias', async () => {
    const efectos = { ejecutados: 0 };
    await runWithTools(clienteQuePide('lookup_order'), { ...base, efectos });
    expect(efectos.ejecutados).toBe(0);
  });

  it('cuenta todas las que mueven plata o dejan una solicitud', async () => {
    for (const tool of [
      'create_order',
      'update_order',
      'registrar_pago',
      'cancelar_pedido',
      'reembolsar',
      'ofrecer_descuento',
    ]) {
      const efectos = { ejecutados: 0 };
      await runWithTools(clienteQuePide(tool), { ...base, efectos });
      expect(efectos.ejecutados, tool).toBe(1);
    }
  });
});
