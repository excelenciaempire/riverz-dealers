import { describe, expect, it } from 'vitest';
import {
  enUnaLinea,
  plantillaUsable,
  ventanaAbierta,
  PLANTILLAS_LLAMADA,
} from './whatsapp-during-call';

/**
 * Los tres errores por los que el WhatsApp que el agente prometía por teléfono
 * NO llegaba, cada uno con su prueba.
 *
 * Los tres compartían la misma trampa: el `POST` a Meta devuelve 200 con un
 * `wamid` y el fallo llega DESPUÉS por webhook, así que la herramienta le
 * contestaba al agente que había salido bien y él le decía al cliente «ya te lo
 * mandé». Por eso todo esto se decide ANTES de mandar, y por eso se prueba.
 */

type Fila = { name: string; category: string; status: string };

/** Supabase de mentira: devuelve las filas que se le pasan. */
function fakeDb(filas: Fila[] | null) {
  const q: Record<string, unknown> = {
    select: () => q,
    eq: () => q,
    in: () => q,
    gt: () => q,
    limit: () => Promise.resolve({ data: filas }),
    then: (r: (v: { data: Fila[] | null }) => unknown) => r({ data: filas }),
  };
  return { from: () => q } as never;
}

const utility = (name: string): Fila => ({ name, category: 'Utility', status: 'Approved' });
const marketing = (name: string): Fila => ({ name, category: 'Marketing', status: 'Approved' });
const pendiente = (name: string): Fila => ({ name, category: 'Utility', status: 'Pending' });

describe('elegir la plantilla (131049: Meta recategoriza)', () => {
  it('usa la del escenario cuando está aprobada y es utility', async () => {
    const db = fakeDb([utility('llamada_pago_pedido'), utility('llamada_resumen_pedido')]);
    expect(await plantillaUsable(db, 'ws', 'link_de_pago')).toBe('llamada_pago_pedido');
  });

  it('NUNCA devuelve una plantilla que Meta dejó en marketing', async () => {
    // El caso real: `seguimiento_llamada` se pidió UTILITY y volvió MARKETING.
    // Las marketing caen bajo el tope de frecuencia por usuario y el mensaje
    // rebota con 131049 después de que la tool ya dijo que salió bien.
    const db = fakeDb([marketing('llamada_pago_pedido'), utility('llamada_resumen_pedido')]);
    const elegida = await plantillaUsable(db, 'ws', 'link_de_pago');
    expect(elegida).not.toBe('llamada_pago_pedido');
    expect(elegida).toBe('llamada_resumen_pedido');
  });

  it('NUNCA devuelve una plantilla que Meta todavía no aprobó', async () => {
    const db = fakeDb([pendiente('llamada_pago_pedido'), utility('llamada_info_producto')]);
    expect(await plantillaUsable(db, 'ws', 'link_de_pago')).toBe('llamada_info_producto');
  });

  it('sin ninguna usable devuelve null, para poder decir la verdad', async () => {
    // Mandar igual seria prometerle al cliente algo que Meta va a rechazar.
    const db = fakeDb([marketing('llamada_pago_pedido')]);
    expect(await plantillaUsable(db, 'ws', 'link_de_pago')).toBeNull();
    expect(await plantillaUsable(fakeDb([]), 'ws', 'otro')).toBeNull();
    expect(await plantillaUsable(fakeDb(null), 'ws', 'otro')).toBeNull();
  });

  it('un escenario desconocido cae en el catch-all, no explota', async () => {
    const db = fakeDb([utility(PLANTILLAS_LLAMADA.otro)]);
    expect(await plantillaUsable(db, 'ws', 'cualquier_cosa')).toBe(PLANTILLAS_LLAMADA.otro);
    expect(await plantillaUsable(db, 'ws', null)).toBe(PLANTILLAS_LLAMADA.otro);
  });
});

describe('la ventana de 24 h (131047: re-engagement)', () => {
  it('está cerrada si el cliente nunca escribió', async () => {
    expect(await ventanaAbierta(fakeDb([]), 'conv')).toBe(false);
  });

  it('está cerrada si no hay ni conversación', async () => {
    // Fue el caso real: el contacto nunca habia escrito por WhatsApp.
    expect(await ventanaAbierta(fakeDb([]), null)).toBe(false);
  });

  it('está abierta si el cliente escribió dentro de las 24 h', async () => {
    expect(await ventanaAbierta(fakeDb([{ name: 'x' } as never]), 'conv')).toBe(true);
  });
});

describe('el parámetro de la plantilla', () => {
  it('nunca lleva un salto de línea', () => {
    // Uno solo hace que Meta rechace el mensaje ENTERO, y el agente ya dijo
    // que lo mando. El texto que escribe el modelo viene con renglones.
    const crudo = 'Acá van tus links:\n\nPEDIDO 1\nhttps://a.co\n\nPEDIDO 2\nhttps://b.co';
    const salida = enUnaLinea(crudo);
    expect(salida).not.toMatch(/[\n\r\t]/);
    expect(salida).toContain('https://a.co');
    expect(salida).toContain('https://b.co');
  });

  it('nunca lleva cuatro espacios seguidos', () => {
    expect(enUnaLinea('hola     mundo')).not.toMatch(/\s{4,}/);
  });

  it('no se pasa del largo que Meta admite', () => {
    expect(enUnaLinea('x'.repeat(5000)).length).toBeLessThanOrEqual(900);
  });
});
