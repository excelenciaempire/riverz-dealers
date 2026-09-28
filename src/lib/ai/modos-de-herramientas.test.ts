import { describe, it, expect } from 'vitest';
import { construirHerramientas } from './runner';
import type { AiAgent } from './types';

/**
 * Los tres modos salen del MISMO constructor.
 *
 * Antes cada llamador armaba su lista: el borrador con una herramienta, los
 * comentarios con tres, el agente con dieciséis. Agregar una capacidad —la
 * búsqueda web, sin ir más lejos— la sumaba a una sola, y las otras dos se
 * quedaban atrás sin que nadie se enterara.
 *
 * Lo que se fija acá no es la lista exacta —eso cambia—: es que el recorte de
 * cada modo siga siendo el que se prometió, y que una capacidad nueva llegue a
 * los tres salvo que su modo la excluya a propósito.
 */

const agente = {
  id: 'a1',
  workspace_id: 'w1',
  name: 'Test',
  model: 'claude-opus-5',
  product_scope: 'all',
  // Todo prendido: acá se prueba el recorte por MODO, no la pizarra.
  tools: {
    buscar_producto: 'auto',
    ver_producto: 'auto',
    lookup_order: 'auto',
    crear_pedido: 'auto',
    crear_checkout: 'auto',
    registrar_pago: 'auto',
    etiquetar_contacto: 'auto',
    cerrar_conversacion: 'auto',
    ver_contacto: 'auto',
    no_se_la_respuesta: 'auto',
    buscar_en_internet: 'auto',
  },
} as unknown as AiAgent;

const shopify = { config: null, canCreateOrders: true } as never;

const nombres = (modo: 'conversacion' | 'borrador' | 'comentario') =>
  construirHerramientas({
    agent: agente,
    hayContacto: true,
    shopify,
    otherStore: null,
    voiceCtx: null,
    topeDescuento: 0,
    modo,
  }).map((t) => ('name' in t ? t.name : undefined));

describe('los modos de construirHerramientas', () => {
  it('el borrador NO puede escribir en la tienda', () => {
    const b = nombres('borrador');
    for (const escribe of ['create_order', 'create_checkout', 'registrar_pago']) {
      expect(b).not.toContain(escribe);
    }
    // Pero sí lee: es lo que le permite proponer algo útil.
    expect(b).toContain('lookup_order');
    expect(b).toContain('buscar_producto');
  });

  it('un comentario no administra un hilo de la bandeja', () => {
    const c = nombres('comentario');
    expect(c).not.toContain('etiquetar_contacto');
    expect(c).not.toContain('cerrar_conversacion');
    // Vender sí puede: es media razón de contestar un comentario.
    expect(c).toContain('lookup_order');
  });

  it('la búsqueda en internet llega a los TRES', () => {
    // La que motivó todo esto: se sumó al agente y no llegaba ni al borrador
    // ni a los comentarios, porque cada uno armaba su lista aparte.
    expect(nombres('conversacion')).toContain('web_search');
    expect(nombres('borrador')).toContain('web_search');
    expect(nombres('comentario')).toContain('web_search');
  });

  it('el modo por defecto es el agente contestando', () => {
    expect(nombres('conversacion')).toEqual(
      construirHerramientas({
        agent: agente,
        hayContacto: true,
        shopify,
        otherStore: null,
        voiceCtx: null,
        topeDescuento: 0,
      }).map((t) => ('name' in t ? t.name : undefined)),
    );
  });
});
