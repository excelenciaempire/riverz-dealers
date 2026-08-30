import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from './runner';
import type { AiAgent } from './types';

/**
 * Con qué cierra la venta.
 *
 * El agente sabe hacer las dos cosas —mandar a la caja de la tienda y tomar el
 * pedido en la conversación— y cuál hacía no lo decidía nadie: salía de qué
 * herramientas estuvieran prendidas, y con las dos prendidas elegía el modelo,
 * mensaje a mensaje. No es una preferencia del comercio, es un accidente. Un
 * comercio de contra-entrega que manda a la caja pierde a quien no tiene
 * tarjeta; uno de tarjeta que pide la dirección por chat le agrega diez
 * mensajes a una compra de un clic.
 *
 * Lo que se fija acá es que el ajuste sólo ELIJA, nunca amplíe: la pizarra de
 * herramientas sigue siendo la que dice qué está permitido.
 */

const agente = (extra: Partial<AiAgent> = {}) =>
  ({
    id: 'a1',
    workspace_id: 'w1',
    name: 'Test',
    model: 'claude-opus-5',
    language: 'es',
    product_scope: 'all',
    tools: { crear_checkout: 'auto', crear_pedido: 'auto' },
    ...extra,
  }) as unknown as AiAgent;

/** El prompt completo, con Shopify conectado y pedidos habilitados. */
const contacto = { id: 'c1', workspace_id: 'w1', channel: 'whatsapp', name: 'Ana' } as never;
const contexto = { messages: [], rollingSummary: null, idleResetHint: null } as never;

const prompt = (a: AiAgent, canCreateOrders = true) =>
  buildSystemPrompt(
    a,
    contacto,
    contacto,
    null,
    [],
    contexto,
    [],
    null,
    { config: null, canCreateOrders } as never,
  );

describe('cómo se cobra', () => {
  it('por defecto, según cómo quiera pagar', () => {
    const p = prompt(agente());
    expect(p).toContain('contra entrega');
    expect(p).toContain('enlace de pago');
  });

  it('siempre a la caja', () => {
    const p = prompt(agente({ cobro_modo: 'checkout' } as Partial<AiAgent>));
    expect(p).toContain('siempre por la caja de la tienda');
    // Y lo que NO tiene que hacer: pedir la dirección por chat cuando la caja
    // ya la pide. Son diez mensajes de más en una compra de un clic.
    expect(p).toContain('No le pidas la dirección');
  });

  it('siempre en el chat', () => {
    const p = prompt(agente({ cobro_modo: 'chat' } as Partial<AiAgent>));
    expect(p).toContain('siempre tomas el pedido aquí');
    expect(p).toContain('No la mandes a la caja');
  });

  it('sin la herramienta de pedidos no se dice nada', () => {
    // No hay nada que elegir: darle al modelo una instrucción que no puede
    // cumplir es peor que no decirle nada.
    const p = prompt(agente({ tools: { crear_checkout: 'auto', crear_pedido: 'off' } } as never));
    expect(p).not.toContain('Cómo se cobra');
  });

  it('sin la caja tampoco', () => {
    const p = prompt(agente({ tools: { crear_checkout: 'off', crear_pedido: 'auto' } } as never));
    expect(p).not.toContain('Cómo se cobra');
  });

  it('el ajuste no amplía permisos: la pizarra manda', () => {
    // `crear_pedido` apagado y modo "chat": el agente NO puede crear pedidos,
    // así que no se le dice que los tome. Un ajuste que ampliara permisos por
    // su cuenta convertiría la pizarra en un adorno.
    const p = prompt(
      agente({
        cobro_modo: 'chat',
        tools: { crear_checkout: 'auto', crear_pedido: 'off' },
      } as never),
    );
    expect(p).not.toContain('siempre tomas el pedido aquí');
  });
});

/**
 * Las dos instrucciones no pueden pelearse.
 *
 * La de cobro decia "no le pidas la direccion, eso lo pide la caja" y la de
 * cierre, tres lineas mas abajo, decia "reune la direccion de envio completa y
 * el metodo de pago". El modelo resolvia el empate solo, mensaje a mensaje.
 */
describe('la caja y el cierre dicen lo mismo', () => {
  it('en modo caja, el pedido no se arma en el chat', () => {
    const p = prompt(agente({ cobro_modo: 'checkout' } as Partial<AiAgent>));
    expect(p).toContain('la venta se cierra en la caja, no en el chat');
    // La frase que se contradecia con la de arriba.
    expect(p).not.toContain('la dirección de envío completa');
  });

  it('en los otros modos el cierre sigue pidiendo los datos', () => {
    for (const modo of ['chat', 'segun_pago'] as const) {
      const p = prompt(agente({ cobro_modo: modo } as Partial<AiAgent>));
      expect(p, modo).toContain('la dirección de envío completa');
    }
  });

  it('sin la caja no hay modo caja que valga: el cierre normal manda', () => {
    // `cobro_modo` es una preferencia guardada; si la herramienta esta
    // apagada, la preferencia no puede dejar al agente sin instruccion de
    // cierre.
    const p = prompt(
      agente({
        cobro_modo: 'checkout',
        tools: { crear_checkout: 'off', crear_pedido: 'auto' },
      } as never),
    );
    expect(p).toContain('la dirección de envío completa');
    expect(p).not.toContain('la venta se cierra en la caja');
  });
});

/**
 * Con que se puede pagar, y el contra entrega adentro de esa lista.
 *
 * Era la pregunta mas comun sin respuesta: el prompt sabia mandar a la caja
 * pero no sabia decir con QUE se paga en ella. Y el 2026-08-29 la IA le
 * confirmo "pago contra entrega" a la clienta de un comercio que no lo acepta,
 * en publico bajo el anuncio, y le pidio la direccion.
 *
 * Ahora se declara al crear el asistente, una vez, y `null` —no declarado— es
 * un estado distinto de la lista vacia.
 */
describe('medios de pago', () => {
  const con = (
    modo: 'segun_pago' | 'chat' | 'checkout',
    medios: string[] | null,
  ) => prompt(agente({ cobro_modo: modo, medios_pago: medios } as Partial<AiAgent>));

  it('sin declarar: no nombra ninguno y pasa a una persona', () => {
    const p = con('segun_pago', null);
    expect(p).toContain('no nombres ningún medio por tu cuenta');
    // Y el contra entrega, que es uno de la lista, tampoco se confirma.
    expect(p).toContain('NO lo ofrezcas tú nunca');
  });

  it('declarados: los nombra, y solo esos', () => {
    const p = con('checkout', ['tarjeta', 'mercadopago', 'transferencia']);
    expect(p).toContain(
      'tarjeta de crédito o débito, transferencia bancaria y Mercado Pago',
    );
    expect(p).toContain('nombra ÉSOS y ninguno más');
  });

  it('el orden es el del catalogo, no el que llego', () => {
    // Dos comercios con los mismos medios tienen que leer la misma frase: sin
    // orden estable, el prompt cambia solo y con el cambia el cache.
    const a = con('checkout', ['mercadopago', 'tarjeta']);
    const b = con('checkout', ['tarjeta', 'mercadopago']);
    expect(a).toContain('tarjeta de crédito o débito y Mercado Pago');
    expect(a.includes('tarjeta de crédito o débito y Mercado Pago')).toBe(
      b.includes('tarjeta de crédito o débito y Mercado Pago'),
    );
  });

  it('un medio inventado se descarta', () => {
    // La columna es jsonb: cualquiera puede escribirle cualquier cosa, y un
    // medio que el prompt no conoce es una promesa que nadie puede cumplir.
    const p = con('checkout', ['tarjeta', 'cripto', 'trueque']);
    expect(p).toContain('tarjeta de crédito o débito');
    expect(p).not.toContain('cripto');
    expect(p).not.toContain('trueque');
  });

  it('la lista vacia NO es lo mismo que no declarada', () => {
    // Vacia = "ya lo mire y no hay ninguno". Ahi el contra entrega es un NO
    // firme, no una duda.
    const p = con('segun_pago', []);
    expect(p).toContain('NO hay pago al recibir');
    expect(p).not.toContain('NO lo ofrezcas tú nunca');
  });
});

/**
 * El contra entrega es un DATO, no una deduccion.
 *
 * El 2026-08-29 la IA le confirmo "pago contra entrega" a la clienta de un
 * comercio que no lo acepta, en publico bajo el anuncio, y le pidio la
 * direccion. Se arreglo sacando el supuesto del prompt — pero eso dejo al
 * comercio que SI cobra al recibir teniendo que escribirse una regla a mano
 * para habilitar lo unico que hace. Ahora es una casilla con TRES estados.
 */
describe('pago al recibir', () => {
  const conModo = (modo: 'segun_pago' | 'chat', acepta: boolean | null) =>
    prompt(
      agente({
        cobro_modo: modo,
        // El contra entrega vive DENTRO de la lista de medios: `null` es no
        // declarado, `[]` es "no hay", y estar en la lista es que sí.
        medios_pago: acepta === null ? null : acepta ? ['contraentrega'] : [],
      } as Partial<AiAgent>),
    );

  it('sin declarar: no lo ofrece ni lo confirma, pasa a una persona', () => {
    const p = conModo('segun_pago', null);
    expect(p).toContain('NO lo ofrezcas tú nunca');
    expect(p).toContain('pasa la conversación a una persona');
  });

  it('declarado que SI: toma el pedido ahi mismo', () => {
    const p = conModo('segun_pago', true);
    expect(p).toContain('sí trabajas con pago al recibir');
    // Y deja de mandarlo a buscar el permiso en las reglas.
    expect(p).not.toContain('NO lo ofrezcas tú nunca');
  });

  it('declarado que NO: lo dice y sigue', () => {
    const p = conModo('segun_pago', false);
    expect(p).toContain('NO hay pago al recibir');
    expect(p).not.toContain('NO lo ofrezcas tú nunca');
  });

  /**
   * El comercio que vive del contra entrega usa modo "chat", y ahi el prompt
   * decia como TOMAR el pedido pero no si ese medio existe.
   */
  it('en modo chat tambien se entera', () => {
    // El comercio que vive del contra entrega usa este modo, y el prompt
    // decia como TOMAR el pedido pero no si ese medio de pago existe.
    expect(conModo('chat', true)).toContain('sí trabajas con pago al recibir');
    expect(conModo('chat', false)).toContain('NO hay pago al recibir');
    // Sin declarar no lo afirma ni lo niega: lo pasa a una persona.
    expect(conModo('chat', null)).toContain('NO lo ofrezcas tú nunca');
  });
})
