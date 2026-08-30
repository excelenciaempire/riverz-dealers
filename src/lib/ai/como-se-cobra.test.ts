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
 * "Con que puedo pagar" no puede terminar en una persona.
 *
 * Era la pregunta mas comun sin respuesta: el prompt sabia mandar a la caja
 * pero no sabia decir con que se paga en ella, asi que escalaba.
 */
describe('con que se puede pagar', () => {
  it('en modo caja se dice de donde sale la respuesta', () => {
    const p = prompt(agente({ cobro_modo: 'checkout' } as Partial<AiAgent>));
    expect(p).toContain('nunca inventes uno');
  });
})
