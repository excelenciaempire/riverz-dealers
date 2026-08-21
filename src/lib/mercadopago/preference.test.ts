import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./oauth', () => ({ freshAccessToken: vi.fn(async () => 'APP_USR-token') }));
vi.mock('@/lib/base-url', () => ({ publicBaseUrl: () => 'https://riverz.co' }));

import { freshAccessToken } from './oauth';
import { crearLinkDePago } from './preference';

/**
 * Un link de pago mal armado cobra de menos, cobra de más, o cobra a la cuenta
 * equivocada. Es la única herramienta del agente que mueve dinero de verdad
 * hacia adentro, así que lo que se prueba acá es qué NO llega a Mercado Pago.
 */

const db = {} as never;
const items = [{ title: 'Serum', quantity: 2, unit_price: 69000 }];

function respuestaMp(body: unknown, ok = true, status = 201) {
  // Sin `as never`: hace falta poder leer `.mock.calls` para inspeccionar qué
  // se le mandó a Mercado Pago, que es la mitad de lo que estas pruebas miran.
  return vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }));
}

/** El cuerpo JSON que se le mandó a Mercado Pago en la llamada `n`. */
function cuerpoEnviado(f: ReturnType<typeof respuestaMp>, n = 0) {
  // El doble no declara argumentos, así que TypeScript tipa `calls` como
  // tuplas vacías: se lee por `unknown[]`, que es lo que realmente llega.
  const args = f.mock.calls[n] as unknown as unknown[];
  const init = args?.[1] as { body?: string } | undefined;
  return JSON.parse(init?.body ?? '{}');
}

beforeEach(() => {
  vi.mocked(freshAccessToken).mockResolvedValue('APP_USR-token');
});

describe('crearLinkDePago', () => {
  it('devuelve el link y el id para poder casar el pago', async () => {
    vi.stubGlobal('fetch', respuestaMp({ id: 'pref-1', init_point: 'https://mp/pay' }));
    const r = await crearLinkDePago(db, { workspaceId: 'w1', items });
    expect(r).toEqual({ url: 'https://mp/pay', preferenceId: 'pref-1' });
  });

  it('avisa a dónde mandar el pago, con el comercio en la URL', async () => {
    const f = respuestaMp({ id: 'p', init_point: 'https://mp/pay' });
    vi.stubGlobal('fetch', f);
    await crearLinkDePago(db, { workspaceId: 'w1', items });
    const cuerpo = cuerpoEnviado(f);
    expect(cuerpo.notification_url).toContain('/api/mercadopago/webhook/w1/');
  });

  it('manda el pedido como referencia externa', async () => {
    // Sin esto habría que adivinar qué se pagó por monto y fecha.
    const f = respuestaMp({ id: 'p', init_point: 'https://mp/pay' });
    vi.stubGlobal('fetch', f);
    await crearLinkDePago(db, { workspaceId: 'w1', items, orderId: 'o-9' });
    const cuerpo = cuerpoEnviado(f);
    expect(cuerpo.external_reference).toBe('o-9');
  });

  it('descarta un precio que no es un número o es cero', async () => {
    // Un item así convierte el link en un cobro de cero pesos.
    vi.stubGlobal('fetch', respuestaMp({ id: 'p', init_point: 'https://mp/pay' }));
    const r = await crearLinkDePago(db, {
      workspaceId: 'w1',
      items: [
        { title: 'A', quantity: 1, unit_price: 0 },
        { title: 'B', quantity: 1, unit_price: NaN },
      ],
    });
    expect(r).toMatchObject({ error: 'sin_items' });
  });

  it('normaliza una cantidad imposible', async () => {
    const f = respuestaMp({ id: 'p', init_point: 'https://mp/pay' });
    vi.stubGlobal('fetch', f);
    await crearLinkDePago(db, {
      workspaceId: 'w1',
      items: [{ title: 'A', quantity: -3, unit_price: 100 }],
    });
    const cuerpo = cuerpoEnviado(f);
    expect(cuerpo.items[0].quantity).toBe(1);
  });

  it('sin Mercado Pago conectado lo dice, en vez de fallar raro', async () => {
    vi.mocked(freshAccessToken).mockResolvedValue(null);
    const r = await crearLinkDePago(db, { workspaceId: 'w1', items });
    expect(r).toMatchObject({ error: 'sin_conexion' });
  });

  it('si Mercado Pago rechaza, no inventa un link', async () => {
    vi.stubGlobal('fetch', respuestaMp({ message: 'invalid' }, false, 400));
    const r = await crearLinkDePago(db, { workspaceId: 'w1', items });
    expect(r).toMatchObject({ error: 'mp_rechazo' });
  });

  it('si contesta 200 pero sin link, tampoco lo inventa', async () => {
    vi.stubGlobal('fetch', respuestaMp({ id: 'p' }));
    const r = await crearLinkDePago(db, { workspaceId: 'w1', items });
    expect(r).toMatchObject({ error: 'mp_rechazo' });
  });

  it('si la red falla, no rompe la conversación', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET'); }) as never);
    const r = await crearLinkDePago(db, { workspaceId: 'w1', items });
    expect(r).toMatchObject({ error: 'mp_rechazo' });
  });
});
