import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * La atribución del chat web depende de UNA línea.
 *
 * El enlace de carrito que arma el agente tiene que llevar
 * `attributes[riverz_wvid]`: Shopify arrastra los atributos del carrito hasta
 * el pedido, el pedido vuelve por webhook con el id adentro, y recién ahí se
 * puede decir que esa venta salió de esa conversación.
 *
 * El runner cargaba el id y el armador del enlace sabía estamparlo, pero el
 * contexto que los une lo dejaba afuera. Con eso la función entera no llegaba
 * a ejecutarse nunca: `attributeWebchatOrder` cortaba en su primera línea y el
 * comercio veía 0 pedidos y 0 ingresos por el canal — sin ningún error, que es
 * lo que lo hizo invisible. La prueba que existía inyectaba el id directo en
 * `createCheckoutLink` y se salteaba justo el tramo roto.
 */

// `vi.mock` se iza al tope del archivo, así que la fábrica no puede cerrar
// sobre una variable de acá: se declara adentro y se recupera después.
vi.mock('@/lib/shopify/create-checkout', async (original) => {
  const real = await original<Record<string, unknown>>();
  return {
    ...real,
    createCheckoutLink: vi.fn(async () => ({
      checkout_url: 'https://tienda.com/cart/111:1',
      offer_label: '1 unidad(es)',
      total_label: '',
      payment_label: '',
      next_step_for_pili: '',
    })),
  };
});

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

import { createCheckoutLink } from '@/lib/shopify/create-checkout';
import { runTool } from './tools';

const crearEnlace = vi.mocked(createCheckoutLink);

const shopify = {
  shopDomain: 'demo.myshopify.com',
  accessToken: 'tok',
  apiVersion: '2025-10',
  workspaceId: 'w1',
  contactId: 'c1',
  agentId: 'a1',
  conversationId: 'conv1',
  channel: 'webchat',
  dryRun: true,
};

beforeEach(() => crearEnlace.mockClear());

describe('create_checkout desde el chat web', () => {
  it('le pasa el id del visitante al armador del enlace', async () => {
    await runTool(
      'create_checkout',
      { items: [{ variant_id: '111', quantity: 1 }] },
      { ...shopify, visitorId: 'wv_73f8d901-a0d2-4a95-9bcc-4aaceb96e7d3' } as never,
    );
    expect(crearEnlace).toHaveBeenCalledOnce();
    const ctx = crearEnlace.mock.calls[0][1] as { visitorId?: string | null };
    expect(ctx.visitorId).toBe('wv_73f8d901-a0d2-4a95-9bcc-4aaceb96e7d3');
  });

  it('en los demás canales no inventa uno', async () => {
    await runTool(
      'create_checkout',
      { items: [{ variant_id: '111', quantity: 1 }] },
      { ...shopify, channel: 'whatsapp', visitorId: null } as never,
    );
    const ctx = crearEnlace.mock.calls[0][1] as { visitorId?: string | null };
    expect(ctx.visitorId).toBeNull();
  });
});
