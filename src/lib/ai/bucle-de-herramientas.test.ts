import { describe, it, expect, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';

/**
 * El bucle de herramientas tiene tope.
 *
 * El 2026-08-30, al dejar de contar las pausas de la búsqueda web, se perdió
 * también la línea que contaba las vueltas: un modelo que pedía herramientas
 * sin parar seguía pidiendo, y cada vuelta es una petición que se descuenta
 * del saldo del comercio. De paso el rescate de un PDF rechazado, que mira si
 * es la primera vuelta, no corría nunca.
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

import { runWithTools, AGENTIC_LOOP_MAX_ITERS } from './tools';

const uso = { input_tokens: 1, output_tokens: 1 };
const texto = { content: [{ type: 'text', text: 'listo' }], stop_reason: 'end_turn', usage: uso };

const base = {
  model: 'claude-sonnet-5-5',
  max_tokens: 256,
  system: 's',
  messages: [{ role: 'user' as const, content: 'hola' }],
  tools: [] as Anthropic.ToolUnion[],
  shopify: null,
};

const ofrecida = (name: string): Anthropic.Tool[] => [
  { name, description: 'Test tool', input_schema: { type: 'object', properties: {} } },
];

describe('el bucle de herramientas', () => {
  it('corta después de las vueltas permitidas aunque el modelo siga pidiendo', async () => {
    let llamadas = 0;
    const client = {
      messages: {
        create: async (p: Anthropic.MessageCreateParams) => {
          llamadas += 1;
          if (!p.tools) return texto;
          return {
            content: [{ type: 'tool_use', id: `t${llamadas}`, name: 'lookup_order', input: {} }],
            stop_reason: 'tool_use',
            usage: uso,
          };
        },
      },
    } as unknown as Anthropic;
    const r = await runWithTools(client, { ...base, tools: ofrecida('lookup_order') });
    expect(llamadas).toBe(AGENTIC_LOOP_MAX_ITERS + 1);
    expect(r.truncated).toBe(true);
    expect(r.iterations).toBe(AGENTIC_LOOP_MAX_ITERS + 1);
  });

  it('una respuesta directa es una vuelta', async () => {
    const client = { messages: { create: async () => texto } } as unknown as Anthropic;
    const r = await runWithTools(client, base);
    expect(r.iterations).toBe(1);
    expect(r.truncated).toBe(false);
  });

  it('rescata un PDF que el proveedor rechaza en la primera vuelta', async () => {
    const pedidos: Anthropic.MessageCreateParams[] = [];
    const client = {
      messages: {
        create: async (p: Anthropic.MessageCreateParams) => {
          pedidos.push(p);
          if (pedidos.length === 1) {
            throw new Anthropic.BadRequestError(
              400,
              { type: 'error', error: { type: 'invalid_request_error', message: 'document exceeds the page limit' } },
              'document exceeds the page limit',
              new Headers()
            );
          }
          return texto;
        },
      },
    } as unknown as Anthropic;
    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: [
          { type: 'document', source: { type: 'url', url: 'https://example.com/catalogo.pdf' } },
          { type: 'text', text: 'Te mando el catálogo' },
        ],
      },
    ];
    const r = await runWithTools(client, { ...base, messages });
    expect(r.text).toBe('listo');
    expect(pedidos).toHaveLength(2);
    expect(JSON.stringify(pedidos[1].messages)).not.toContain('"document"');
  });
});
