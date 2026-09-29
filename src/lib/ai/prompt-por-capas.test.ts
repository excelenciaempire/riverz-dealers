import { describe, it, expect, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';

/**
 * El prompt del asistente por capas, y la caché de cada una.
 *
 * El proveedor cachea por prefijo exacto. La capa `estable` —lo del agente—
 * se escribe con la caché de una hora y la leen todos los chats de ese agente
 * a una décima parte del precio, pero sólo si sale IGUAL byte a byte: un dato
 * de la persona, del producto detectado o del orden en que sincronizó la
 * tienda, y cada chat vuelve a pagar la escritura entera, al doble.
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

import { armarSystemPrompt, buildSystemPrompt, systemDelTurno, unirSystem, type ProductRow } from './runner';
import { mensajesConCache, runWithTools, systemConCache } from './tools';
import { UNTRUSTED_CONTENT_POLICY } from './input-security';
import type { AiAgent } from './types';

const agente = (extra: Partial<AiAgent> = {}) =>
  ({
    id: 'a1',
    workspace_id: 'w1',
    name: 'Sofía',
    model: 'claude-sonnet-5-5',
    language: 'es',
    tone: 'friendly',
    max_response_chars: 500,
    persona: 'Asesora de la tienda.',
    product_scope: 'all',
    tools: { crear_checkout: 'auto', crear_pedido: 'auto' },
    ...extra,
  }) as unknown as AiAgent;

const producto = (id: string, title: string, material = ''): ProductRow => ({
  id,
  title,
  description: `Descripción de ${title}`,
  price_min: 100,
  price_max: 100,
  url: `https://tienda.test/products/${id}`,
  product_type: null,
  vendor: null,
  tags: null,
  training_material: material,
});

const catalogo = [
  producto('p1', 'Serum', 'Ficha larga del serum. '.repeat(40)),
  producto('p2', 'Crema'),
  producto('p3', 'Tónico'),
];

const contexto = (resumen: string | null) =>
  ({ messages: [], rollingSummary: resumen, idleResetHint: null }) as never;

function capas(
  persona: { nombre: string; resumen: string | null; notas: string[]; registro: 'neutro' | 'rioplatense' },
  opciones: { products?: ProductRow[]; match?: string | null; agent?: AiAgent } = {}
) {
  const contacto = {
    id: `c-${persona.nombre}`,
    workspace_id: 'w1',
    channel: 'whatsapp',
    name: persona.nombre,
    phone: '+5491100000000',
    ai_summary: `Le gusta ${persona.nombre}`,
  } as never;
  return armarSystemPrompt(
    opciones.agent ?? agente(),
    contacto,
    contacto,
    null,
    persona.notas,
    contexto(persona.resumen),
    opciones.products ?? catalogo,
    opciones.match ? { product_id: opciones.match, score: 1, confidence: 'high', via: 'text' } as never : null,
    { config: null, canCreateOrders: true } as never,
    null,
    'ARS',
    'Regla del comercio: envío gratis desde dos unidades.',
    persona.registro,
    null,
    'whatsapp'
  );
}

const ana = { nombre: 'Ana', resumen: 'Preguntó por envíos', notas: ['Pagó por transferencia'], registro: 'rioplatense' as const };
const luis = { nombre: 'Luis', resumen: null, notas: [], registro: 'neutro' as const };

describe('la capa estable', () => {
  it('sale igual para dos personas distintas del mismo agente', () => {
    const a = capas(ana, { match: 'p1' });
    const b = capas(luis);
    expect(a.estable).toBe(b.estable);
    expect(a.estable).not.toContain('Ana');
    expect(a.estable).not.toContain('Luis');
    expect(a.cliente).toContain('Ana');
    expect(b.cliente).toContain('Luis');
  });

  it('no depende del orden en que sincronizó la tienda', () => {
    const a = capas(ana, { products: catalogo });
    const b = capas(ana, { products: [...catalogo].reverse() });
    expect(a.estable).toBe(b.estable);
  });

  it('el trato de tú o de vos va con la persona', () => {
    expect(capas(ana).cliente).toMatch(/vos/);
    expect(capas(luis).cliente).toContain('español neutro');
  });
});

describe('la ficha del producto del que se habla', () => {
  it('va en su propia capa, igual para todos los chats sobre ese producto', () => {
    const a = capas(ana, { match: 'p1' });
    const b = capas(luis, { match: 'p1' });
    expect(a.producto).toContain('<product_knowledge product_id="p1"');
    expect(a.producto).toBe(b.producto);
    expect(capas(ana).producto).toBe('');
  });

  it('cómo se detectó queda en la capa del cliente', () => {
    const a = capas(ana, { match: 'p1' });
    expect(a.producto).not.toContain('detección');
    expect(a.cliente).toContain('El cliente está mencionando Serum (detección high, vía text)');
  });

  it('los productos asignados se conocen a fondo desde la capa estable', () => {
    const especifico = agente({ product_scope: 'specific' });
    const a = capas(ana, { agent: especifico, products: catalogo.slice(0, 1), match: 'p1' });
    expect(a.estable).toContain('<product_knowledge product_id="p1"');
    expect(a.producto).toBe('');
    expect(a.estable).toBe(capas(luis, { agent: especifico, products: catalogo.slice(0, 1) }).estable);
  });
});

describe('lo que se suma en cada turno', () => {
  it('las políticas de pedidos van con lo estable; el traspaso, con el turno', () => {
    const t = systemDelTurno(capas(ana), {
      agent: agente(),
      recoveryContext: null,
      channel: 'whatsapp',
      traspaso: 'Reclamo por un pedido que no llegó',
      inboundText: 'No me llegó',
    });
    expect(t.estable).toContain('GESTIÓN DE PEDIDOS Y EVIDENCIA');
    expect(t.turno).toContain('El triaje vio: Reclamo por un pedido que no llegó');
    expect(t.cliente).not.toContain('GESTIÓN DE PEDIDOS');
    expect(t.estable).not.toContain('El triaje vio');
  });

  it('las políticas de pedidos van sólo a quien puede crear o corregir pedidos', () => {
    const turno = (herramientas: string[]) =>
      systemDelTurno(capas(ana), {
        agent: agente(),
        recoveryContext: null,
        channel: 'whatsapp',
        inboundText: 'hola',
        herramientas,
      }).estable;
    expect(turno(['lookup_order', 'buscar_producto'])).not.toContain('GESTIÓN DE PEDIDOS');
    expect(turno(['create_order'])).toContain('GESTIÓN DE PEDIDOS');
    expect(turno(['create_order'])).not.toContain('REGLAS OPERATIVAS DE PEDIDOS');
    expect(turno(['update_order'])).toContain('REGLAS OPERATIVAS DE PEDIDOS');
  });

  it('la política de seguridad no se repite: la agrega el final del prompt', () => {
    expect(capas(ana).estable).not.toContain('SECURITY BOUNDARY');
    expect(capas(ana).estable).toContain('Tu único dominio es el negocio');
  });

  it('en un solo texto dice lo mismo que las capas', () => {
    const p = capas(ana, { match: 'p1' });
    expect(unirSystem(p)).toBe([p.estable, p.producto, p.cliente].join('\n\n'));
    const contacto = { id: 'c', workspace_id: 'w1', channel: 'whatsapp', name: 'Ana' } as never;
    expect(buildSystemPrompt(agente(), contacto, contacto, null, [], contexto(null), catalogo, null)).toBe(
      unirSystem(armarSystemPrompt(agente(), contacto, contacto, null, [], contexto(null), catalogo, null))
    );
  });
});

describe('las marcas de caché', () => {
  const largo = 'x'.repeat(9000);

  it('una hora para lo compartido, cinco minutos para la persona, nada para el turno', () => {
    const bloques = systemConCache({ estable: largo, producto: 'ficha', cliente: 'Ana', turno: 'hoy' }) as Anthropic.TextBlockParam[];
    expect(bloques.map((b) => b.cache_control ?? null)).toEqual([
      { type: 'ephemeral', ttl: '1h' },
      { type: 'ephemeral', ttl: '1h' },
      { type: 'ephemeral' },
      null,
    ]);
  });

  it('la política de seguridad cierra el último bloque, una sola vez', () => {
    const bloques = systemConCache({ estable: largo, cliente: 'Ana' }) as Anthropic.TextBlockParam[];
    expect(bloques).toHaveLength(2);
    expect(bloques[1].text.endsWith(UNTRUSTED_CONTENT_POLICY)).toBe(true);
    expect(bloques[0].text).not.toContain('SECURITY BOUNDARY');
  });

  it('la marca del último mensaje va en una copia y sólo ahí', () => {
    const mensajes: Anthropic.MessageParam[] = [
      { role: 'user', content: 'hola' },
      { role: 'assistant', content: 'hola, ¿en qué te ayudo?' },
      { role: 'user', content: 'precio' },
    ];
    const marcados = mensajesConCache(mensajes);
    expect(marcados[2]).toEqual({ role: 'user', content: [{ type: 'text', text: 'precio', cache_control: { type: 'ephemeral' } }] });
    expect(marcados[0]).toBe(mensajes[0]);
    expect(mensajes[2].content).toBe('precio');
  });

  it('también sobre el resultado de una herramienta, y nunca sobre la respuesta del modelo', () => {
    const conResultado = mensajesConCache([
      { role: 'user', content: 'mi pedido' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'lookup_order', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{}' }] },
    ]);
    expect((conResultado[2].content as Anthropic.ToolResultBlockParam[])[0].cache_control).toEqual({ type: 'ephemeral' });
    const pausa: Anthropic.MessageParam[] = [{ role: 'user', content: 'hola' }, { role: 'assistant', content: 'busco' }];
    expect(mensajesConCache(pausa)).toBe(pausa);
  });

  it('runWithTools manda las capas con sus marcas y cuenta lo escrito a una hora', async () => {
    const pedidos: Anthropic.MessageCreateParams[] = [];
    const client = {
      messages: {
        create: async (p: Anthropic.MessageCreateParams) => {
          pedidos.push(p);
          return {
            content: [{ type: 'text', text: 'listo' }],
            stop_reason: 'end_turn',
            usage: {
              input_tokens: 10,
              output_tokens: 5,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 3000,
              cache_creation: { ephemeral_1h_input_tokens: 2500, ephemeral_5m_input_tokens: 500 },
            },
          };
        },
      },
    } as unknown as Anthropic;
    const r = await runWithTools(client, {
      model: 'claude-sonnet-5-5',
      max_tokens: 256,
      system: { estable: largo, cliente: 'Ana' },
      messages: [{ role: 'user', content: 'hola' }],
      tools: [],
      shopify: null,
    });
    const marcas = [
      ...(pedidos[0].system as Anthropic.TextBlockParam[]).map((b) => b.cache_control),
      ...pedidos[0].messages.flatMap((m) =>
        typeof m.content === 'string' ? [] : m.content.map((b) => ('cache_control' in b ? b.cache_control : undefined))
      ),
    ].filter(Boolean);
    expect(marcas).toEqual([{ type: 'ephemeral', ttl: '1h' }, { type: 'ephemeral' }, { type: 'ephemeral' }]);
    expect(r.cacheWriteTokens).toBe(3000);
    expect(r.cacheWrite1hTokens).toBe(2500);
  });
});
