import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCheckoutLink } from './create-checkout';

/**
 * El carrito de varios productos.
 *
 * Antes el agente sólo podía armar un carrito de UNO: quien quería llevar dos
 * cosas recibía dos enlaces y el segundo le vaciaba el carrito del primero.
 * Estas pruebas fijan que ahora vayan juntos, con los atributos que hacen falta
 * para poder atribuir la venta.
 */

const ctx = (over: Record<string, unknown> = {}) => ({
  shopDomain: 'demo.myshopify.com',
  accessToken: 'shpat_x',
  apiVersion: '2025-10',
  storefrontDomain: 'mitienda.com',
  ...over,
});

beforeEach(() => {
  // `resolveStorefront` llama a /shop.json; con `storefrontDomain` no debería
  // hacer falta la red, pero se corta igual para que la prueba no dependa de eso.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false, json: async () => ({}) })) as never,
  );
});

const url = (r: unknown) => (r as { checkout_url: string }).checkout_url;

describe('carrito con varios productos', () => {
  it('arma UNA sola URL con las dos líneas', async () => {
    const r = await createCheckoutLink(
      { items: [{ variant_id: '111', quantity: 2 }, { variant_id: '222' }] },
      ctx(),
    );
    expect(url(r)).toContain('/cart/111:2,222:1');
  });

  it('lleva la marca de origen para poder atribuir la venta', async () => {
    const r = await createCheckoutLink({ items: [{ variant_id: '111' }] }, ctx());
    expect(url(r)).toContain('attributes%5Briverz_origin%5D=ai');
  });

  it('lleva el id del visitante del chat web', async () => {
    const r = await createCheckoutLink(
      { items: [{ variant_id: '111' }] },
      ctx({ visitorId: 'wv_abc' }),
    );
    expect(url(r)).toContain('wv_abc');
  });

  it('descarta una variante que no es un id', async () => {
    // El valor lo escribe un modelo: si se cuela texto, la URL queda rota y
    // Shopify muestra un carrito vacío justo cuando la persona iba a pagar.
    const r = await createCheckoutLink(
      { items: [{ variant_id: '111' }, { variant_id: 'abc' }, { variant_id: '' }] },
      ctx(),
    );
    expect(url(r)).toContain('/cart/111:1');
    expect(url(r)).not.toContain('abc');
  });

  it('normaliza una cantidad imposible en vez de romper el link', async () => {
    const r = await createCheckoutLink(
      { items: [{ variant_id: '111', quantity: 0 }, { variant_id: '222', quantity: -3 }] },
      ctx(),
    );
    expect(url(r)).toContain('/cart/111:1,222:1');
  });

  it('no cotiza un total que después no coincide con el checkout', async () => {
    const r = (await createCheckoutLink(
      { items: [{ variant_id: '111' }, { variant_id: '222' }] },
      ctx(),
    )) as { total_label: string; next_step_for_pili: string };
    expect(r.total_label).toBe('');
    expect(r.next_step_for_pili).toMatch(/No inventes el precio/);
  });

  it('cuenta los productos y las unidades para que el modelo lo diga bien', async () => {
    const r = (await createCheckoutLink(
      { items: [{ variant_id: '111', quantity: 2 }, { variant_id: '222', quantity: 3 }] },
      ctx(),
    )) as { offer_label: string };
    expect(r.offer_label).toContain('2 productos');
    expect(r.offer_label).toContain('5 unidades');
  });

  it('sin items sigue el camino de siempre y exige un producto', async () => {
    // Sin `items` ni variante pinneada ni default, el link no se puede armar:
    // mejor decirlo que devolver una URL a un carrito vacío.
    const r = (await createCheckoutLink({ quantity: 1 }, ctx())) as { error?: string };
    expect(r.error).toBe('no_variant');
  });

  it('un items vacío no se toma como carrito', async () => {
    const r = (await createCheckoutLink({ items: [] }, ctx())) as { error?: string };
    expect(r.error).toBe('no_variant');
  });
});
