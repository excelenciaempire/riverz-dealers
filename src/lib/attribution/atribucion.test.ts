import { describe, expect, it } from 'vitest';
import { provenBy } from './prueba';
import { esVentaReal, ultimoToquePorLente, type Toque } from './lentes';
import { marcarEnlace, marcaDelLanding } from '@/lib/marketing/enlaces';
import type { ShopifyOrder } from './shopify';

/**
 * La atribución entera, sobre una tienda de mentira.
 *
 * Los tests de al lado prueban cada pieza; éste prueba la DECISIÓN, que es lo
 * que se ve en la tarjeta: dado un día de pedidos reales —unos con marca, otros
 * sin nada, uno cancelado, uno que vino de un anuncio— cuántos terminan en
 * «probadas», cuántos en «influidas» y cuánta plata queda de cada lado.
 *
 * Es el test que se rompe si alguien vuelve a colgarle a Riverz una venta que
 * no es suya, que es exactamente lo que hay que impedir.
 */

const HORA = 3_600_000;
const T0 = Date.parse('2026-08-20T12:00:00.000Z');
const VENTANA = 72 * HORA;

function pedido(over: Partial<ShopifyOrder> & { id: number }): ShopifyOrder {
  return {
    created_at: new Date(T0).toISOString(),
    total_price: '10000',
    currency: 'ARS',
    financial_status: 'paid',
    ...over,
  };
}

function toque(kind: Toque['kind'], hsAntes: number, name: string): Toque {
  return {
    kind,
    entityId: `${kind}-1`,
    name,
    at: new Date(T0 - hsAntes * HORA).toISOString(),
  };
}

/** Reproduce la decisión de la ruta sobre un pedido. */
function clasificar(
  order: ShopifyOrder,
  toques: Toque[],
  mundo: {
    espejo?: { created_by?: string | null; channel?: string | null; checkout_token?: string | null } | null;
    cupones?: Map<string, string>;
    carritos?: Map<string, string>;
    pagos?: Set<string>;
  } = {},
) {
  const proofs = provenBy(
    order,
    mundo.espejo ?? null,
    mundo.cupones ?? new Map(),
    mundo.carritos ?? new Map(),
    mundo.pagos ?? new Set(),
  );
  const fuentes = ultimoToquePorLente(toques, Date.parse(order.created_at), VENTANA);
  const evidence =
    proofs.length > 0 ? 'proven' : fuentes.length > 0 ? 'assisted' : null;
  return { proofs, fuentes, evidence };
}

describe('la decisión, pedido por pedido', () => {
  it('un pedido que nadie tocó no es de Riverz', () => {
    expect(clasificar(pedido({ id: 1 }), []).evidence).toBeNull();
  });

  it('haber hablado antes deja el pedido en INFLUIDAS, nunca en probadas', () => {
    const r = clasificar(pedido({ id: 2 }), [toque('agent', 5, 'Asistente')]);
    expect(r.evidence).toBe('assisted');
    expect(r.proofs).toEqual([]);
  });

  it('la marca del link lo pasa a PROBADAS aunque también haya habido charla', () => {
    const r = clasificar(
      pedido({ id: 3, landing_site: '/products/x?riverz=whatsapp.camp-7' }),
      [toque('agent', 5, 'Asistente')],
    );
    expect(r.evidence).toBe('proven');
    expect(r.proofs).toEqual([
      { kind: 'link_click', detail: 'whatsapp/camp-7' },
    ]);
    // La charla no se pierde: se sigue viendo en el detalle.
    expect(r.fuentes).toHaveLength(1);
  });

  it('el landing de un anuncio NO nos pertenece', () => {
    const r = clasificar(
      pedido({ id: 4, landing_site: '/products/x?utm_source=facebook&fbclid=abc' }),
      [toque('broadcast', 10, 'Campaña de agosto')],
    );
    expect(r.evidence).toBe('assisted');
    expect(r.proofs).toEqual([]);
  });

  it('una charla vieja, fuera de la ventana, no cuenta nada', () => {
    expect(clasificar(pedido({ id: 5 }), [toque('agent', 100, 'Asistente')]).evidence)
      .toBeNull();
  });

  it('un mensaje POSTERIOR a la compra no la explica', () => {
    const despues: Toque = {
      kind: 'broadcast',
      entityId: 'b1',
      name: 'Campaña',
      at: new Date(T0 + HORA).toISOString(),
    };
    expect(clasificar(pedido({ id: 6 }), [despues]).evidence).toBeNull();
  });

  it('cada lente aporta UN toque: el último', () => {
    const r = clasificar(pedido({ id: 7 }), [
      toque('broadcast', 2, 'Campaña nueva'),
      toque('broadcast', 40, 'Campaña vieja'),
      toque('agent', 6, 'Asistente'),
    ]);
    expect(r.fuentes.map((f) => f.name)).toEqual(['Campaña nueva', 'Asistente']);
  });
});

describe('el total de un día, como lo ve la tarjeta', () => {
  const cupones = new Map([['ana-10', 'contacto-ana']]);
  const carritos = new Map([['tok-carrito', new Date(T0 - 20 * HORA).toISOString()]]);
  const pagos = new Set(['9']);

  const dia: Array<{
    order: ShopifyOrder;
    toques: Toque[];
    espejo?: { created_by?: string | null; channel?: string | null; checkout_token?: string | null };
  }> = [
    // 1. Link de campaña → probada.
    {
      order: pedido({ id: 1, total_price: '10000', landing_site: '/p?riverz=whatsapp.c1' }),
      toques: [],
    },
    // 2. El asistente armó el pago → probada.
    {
      order: pedido({
        id: 2,
        total_price: '20000',
        note_attributes: [{ name: 'riverz_origin', value: 'ai' }],
      }),
      toques: [],
    },
    // 3. Carrito recuperado → probada.
    {
      order: pedido({ id: 3, total_price: '30000', checkout_token: 'tok-carrito' }),
      toques: [toque('automation', 20, 'Carrito abandonado')],
    },
    // 4. Cupón personal → probada.
    {
      order: pedido({ id: 4, total_price: '40000', discount_codes: [{ code: 'ANA-10' }] }),
      toques: [],
    },
    // 9. Pago rechazado que volvió → probada.
    { order: pedido({ id: 9, total_price: '50000' }), toques: [] },
    // 5. Sólo charló → influida.
    { order: pedido({ id: 5, total_price: '11000' }), toques: [toque('agent', 3, 'Asistente')] },
    // 6. Campaña sin click → influida.
    {
      order: pedido({ id: 6, total_price: '12000' }),
      toques: [toque('broadcast', 8, 'Campaña de agosto')],
    },
    // 7. Nadie lo tocó → afuera.
    { order: pedido({ id: 7, total_price: '99000' }), toques: [] },
    // 8. Cancelado, con marca y todo → afuera antes de clasificar.
    {
      order: pedido({
        id: 8,
        total_price: '77000',
        landing_site: '/p?riverz=whatsapp.c1',
        cancelled_at: new Date(T0).toISOString(),
      }),
      toques: [],
    },
  ];

  it('separa la plata probada de la influida y descarta lo anulado', () => {
    let probado = 0;
    let probados = 0;
    let influido = 0;
    let influidas = 0;

    for (const fila of dia) {
      if (!esVentaReal(fila.order)) continue;
      const { evidence } = clasificar(fila.order, fila.toques, {
        espejo: fila.espejo ?? null,
        cupones,
        carritos,
        pagos,
      });
      const total = Number(fila.order.total_price);
      if (evidence === 'proven') {
        probados++;
        probado += total;
      } else if (evidence === 'assisted') {
        influidas++;
        influido += total;
      }
    }

    // Cinco probadas: link, checkout del asistente, carrito, cupón y pago.
    expect(probados).toBe(5);
    expect(probado).toBe(150_000);
    // Dos influidas: las que sólo tuvieron charla.
    expect(influidas).toBe(2);
    expect(influido).toBe(23_000);
    // El pedido que nadie tocó y el cancelado no aparecen en ninguna.
    expect(probado + influido).toBe(173_000);
  });
});

describe('el circuito del link, de punta a punta', () => {
  it('lo que se manda es lo que vuelve del pedido', () => {
    // 1. Riverz manda el link de la campaña por WhatsApp.
    const enviado = marcarEnlace('https://tienda.com/products/remera', {
      medio: 'whatsapp',
      campana: 'camp-agosto',
    });

    // 2. La persona hace click; la tienda guarda el landing con su query.
    const u = new URL(enviado);
    const landing = u.pathname + u.search;

    // 3. El pedido llega con ese landing y la venta queda probada.
    const r = clasificar(pedido({ id: 42, landing_site: landing }), []);
    expect(r.evidence).toBe('proven');
    expect(r.proofs[0]).toEqual({
      kind: 'link_click',
      detail: 'whatsapp/camp-agosto',
    });
    // Y se sabe de qué campaña salió.
    expect(marcaDelLanding(landing)?.campana).toBe('camp-agosto');
  });
});
