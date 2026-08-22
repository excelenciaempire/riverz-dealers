import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * El caso que motivó esto: una tienda que vende en pesos y en dólares veía
 * "1.250.000 USD" en la tarjeta de resultados del chat web. El total sumaba
 * las dos divisas y le pegaba la del primer pedido de la lista. Es el número
 * con el que el comercio decide si deja el canal prendido.
 */

interface FilaPedido {
  total_price: number | string | null;
  currency: string | null;
  status: string | null;
}

const filas = {
  conversations: [] as Array<Record<string, unknown>>,
  orders: [] as FilaPedido[],
  messages: [] as Array<Record<string, unknown>>,
};

function fakeAdmin() {
  return {
    from(table: 'conversations' | 'orders' | 'messages') {
      // `lt` acota el período ANTERIOR y `in`/`order`/`limit` leen los mensajes
      // para medir la primera respuesta: sin ellos la cadena se corta.
      let periodoAnterior = false;
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        in: () => chain,
        order: () => chain,
        limit: () => chain,
        gte: () => chain,
        lt: () => {
          periodoAnterior = true;
          return chain;
        },
        then: (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) =>
          Promise.resolve({
            data: table === 'messages' ? [] : periodoAnterior ? [] : filas[table],
            error: null,
          }).then(ok, fail),
      };
      return chain;
    },
  };
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
  }),
}));

vi.mock('@/lib/channels/admin-client', () => ({
  supabaseAdmin: () => fakeAdmin(),
}));

vi.mock('@/lib/workspaces/resolve', () => ({
  resolveWorkspaceIdForUser: async () => 'ws1',
}));

import { GET } from './route';

interface Cuerpo {
  revenue: number;
  currency: string | null;
  orders: number;
  revenue_by_currency: Array<{ currency: string | null; revenue: number; orders: number }>;
}

async function stats(): Promise<Cuerpo> {
  const res = await GET();
  return (await res.json()) as Cuerpo;
}

beforeEach(() => {
  filas.conversations = [
    {
      id: 'c1',
      status: 'open',
      assigned_agent_id: null,
      needs_human_at: null,
      csat: null,
      created_at: new Date().toISOString(),
    },
  ];
  filas.orders = [];
});

describe('GET /api/webchat/stats — ingreso por divisa', () => {
  it('no mezcla divisas: cada una lleva su propio total', async () => {
    filas.orders = [
      { total_price: 1_000_000, currency: 'ARS', status: 'paid' },
      { total_price: '250000', currency: 'ARS', status: 'fulfilled' },
      { total_price: 120, currency: 'USD', status: 'paid' },
    ];

    const body = await stats();

    expect(body.revenue_by_currency).toEqual([
      { currency: 'ARS', revenue: 1_250_000, orders: 2 },
      { currency: 'USD', revenue: 120, orders: 1 },
    ]);
    // La tarjeta muestra este par: tiene que ser una cifra real, no la suma.
    expect(body.revenue).toBe(1_250_000);
    expect(body.currency).toBe('ARS');
  });

  it('con una sola divisa da lo mismo que antes', async () => {
    filas.orders = [
      { total_price: 100, currency: 'ARS', status: 'paid' },
      { total_price: 50, currency: 'ARS', status: 'created' },
    ];

    const body = await stats();

    expect(body.revenue).toBe(150);
    expect(body.currency).toBe('ARS');
    expect(body.revenue_by_currency).toHaveLength(1);
  });

  it('lo cancelado y lo fallido no es ingreso de ninguna divisa', async () => {
    filas.orders = [
      { total_price: 100, currency: 'ARS', status: 'paid' },
      { total_price: 900, currency: 'ARS', status: 'cancelled' },
      { total_price: 700, currency: 'USD', status: 'failed' },
    ];

    const body = await stats();

    expect(body.revenue_by_currency).toEqual([{ currency: 'ARS', revenue: 100, orders: 1 }]);
    // El conteo de pedidos sí los incluye: son conversaciones que compraron.
    expect(body.orders).toBe(3);
  });

  it('sin pedidos cobrables no inventa una divisa', async () => {
    filas.orders = [{ total_price: 100, currency: 'ARS', status: 'cancelled' }];

    const body = await stats();

    expect(body.revenue).toBe(0);
    expect(body.currency).toBeNull();
    expect(body.revenue_by_currency).toEqual([]);
  });
});
