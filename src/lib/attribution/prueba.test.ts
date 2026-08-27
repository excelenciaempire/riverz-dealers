import { describe, expect, it } from 'vitest';
import { provenBy } from './prueba';
import type { ShopifyOrder } from './shopify';

/**
 * La regla que separa una cifra defendible de una inflada. Si estos casos se
 * rompen, Riverz empieza a cobrarse ventas que trajo un anuncio.
 */

const base: ShopifyOrder = {
  id: 1,
  created_at: '2026-08-20T10:00:00.000Z',
  total_price: '1000',
  currency: 'ARS',
};

const sinCupones = new Map<string, string>();

describe('provenBy', () => {
  it('no prueba nada un pedido pelado', () => {
    expect(provenBy(base, null, sinCupones)).toEqual([]);
  });

  it('prueba el link de pago que armó el asistente', () => {
    const order = {
      ...base,
      note_attributes: [{ name: 'riverz_origin', value: 'ai' }],
    };
    expect(provenBy(order, null, sinCupones)).toEqual([{ kind: 'checkout_link' }]);
  });

  it('prueba el pedido que creó el asistente, por tag o por espejo', () => {
    expect(provenBy({ ...base, tags: 'vip, riverz-ia' }, null, sinCupones)).toEqual([
      { kind: 'order_created' },
    ]);
    expect(provenBy(base, { created_by: 'ai' }, sinCupones)).toEqual([
      { kind: 'order_created' },
    ]);
  });

  it('no confunde un pedido espejado con uno creado por la IA', () => {
    expect(provenBy(base, { created_by: 'sync' }, sinCupones)).toEqual([]);
  });

  it('prueba el carrito que estampó el chat web', () => {
    const order = {
      ...base,
      note_attributes: [{ name: 'riverz_wvid', value: 'wv_x' }],
    };
    expect(provenBy(order, null, sinCupones)).toEqual([
      { kind: 'webchat_cart', detail: 'wv_x' },
    ]);
  });

  it('prueba el cupón emitido para una persona, y sólo ese', () => {
    const cupones = new Map([['ig-ana-42', 'contacto-1']]);
    expect(
      provenBy({ ...base, discount_codes: [{ code: 'IG-ANA-42' }] }, null, cupones),
    ).toEqual([{ kind: 'coupon', detail: 'IG-ANA-42' }]);
    // Un cupón público de la tienda no prueba nada: lo tuvo cualquiera.
    expect(
      provenBy({ ...base, discount_codes: [{ code: 'VERANO20' }] }, null, cupones),
    ).toEqual([]);
  });

  it('junta todas las marcas cuando hay más de una', () => {
    const order = {
      ...base,
      tags: 'riverz-ia',
      note_attributes: [
        { name: 'riverz_origin', value: 'ai' },
        { name: 'riverz_wvid', value: 'wv_y' },
      ],
    };
    expect(provenBy(order, null, sinCupones).map((p) => p.kind)).toEqual([
      'order_created',
      'checkout_link',
      'webchat_cart',
    ]);
  });

  describe('carrito recuperado', () => {
    // El recordatorio salió el 19; el pedido es del 20.
    const recordados = new Map([['tok-abc', '2026-08-19T09:00:00.000Z']]);

    it('prueba el carrito que se recordó y después se compró', () => {
      expect(
        provenBy({ ...base, checkout_token: 'tok-abc' }, null, sinCupones, recordados),
      ).toEqual([{ kind: 'cart_recovery' }]);
      // `cart_token` sirve igual: Shopify manda uno u otro según el evento.
      expect(
        provenBy({ ...base, cart_token: 'tok-abc' }, null, sinCupones, recordados),
      ).toEqual([{ kind: 'cart_recovery' }]);
      // Tiendanube y Woo no traen el token en el pedido: sale del espejo.
      expect(
        provenBy(base, { checkout_token: 'tok-abc' }, sinCupones, recordados),
      ).toEqual([{ kind: 'cart_recovery' }]);
    });

    it('no se cuelga la compra que ocurrió ANTES del recordatorio', () => {
      const antes = { ...base, created_at: '2026-08-19T08:00:00.000Z', checkout_token: 'tok-abc' };
      expect(provenBy(antes, null, sinCupones, recordados)).toEqual([]);
    });

    it('no cuenta un carrito que nunca recordamos', () => {
      expect(
        provenBy({ ...base, checkout_token: 'otro' }, null, sinCupones, recordados),
      ).toEqual([]);
    });
  });

  it('aguanta note_attributes con cualquier forma', () => {
    expect(
      provenBy({ ...base, note_attributes: null }, null, sinCupones),
    ).toEqual([]);
    expect(
      provenBy(
        { ...base, note_attributes: 'nada' as never },
        null,
        sinCupones,
      ),
    ).toEqual([]);
  });
});
