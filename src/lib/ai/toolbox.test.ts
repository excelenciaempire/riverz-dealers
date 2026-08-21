import { describe, it, expect } from 'vitest';
import {
  AGENT_TOOLBOX,
  sanitizeTools,
  toolEnabled,
  toolMode,
  toolNeedsApproval,
} from './toolbox';

/**
 * La pizarra decide si sale plata sola. Lo que se fija acá:
 *
 *   1. Aplicarla no le cambió el agente a nadie: sin elección guardada, cada
 *      herramienta se comporta como antes de que existiera.
 *   2. Lo irreversible no puede quedar en automático, ni guardándolo a mano en
 *      la base ni mandándolo por la API.
 *   3. Lo que llega del formulario se filtra: una clave inventada o un modo que
 *      la herramienta no admite no puede terminar mandando.
 */

describe('herencia: aplicar esto no cambia nada', () => {
  it('un agente viejo, sin `tools`, se comporta como antes', () => {
    // `permissions` en null es como nacían los agentes anteriores a la
    // migración 164: todo permitido salvo crear pedidos, que miraba la columna.
    const viejo = { permissions: null, puede_crear_pedidos: false };
    expect(toolMode(viejo, 'crear_checkout')).toBe('auto');
    expect(toolMode(viejo, 'registrar_pago')).toBe('auto');
    expect(toolMode(viejo, 'crear_pedido')).toBe('off');
  });

  it('respeta el permiso viejo apagado', () => {
    const agente = {
      permissions: { crear_checkout: false, registrar_pago: true },
      puede_crear_pedidos: true,
    };
    expect(toolMode(agente, 'crear_checkout')).toBe('off');
    expect(toolMode(agente, 'registrar_pago')).toBe('auto');
    expect(toolMode(agente, 'crear_pedido')).toBe('auto');
  });

  it('lo elegido gana sobre el permiso viejo', () => {
    const agente = {
      permissions: { crear_checkout: true },
      tools: { crear_checkout: 'aprobacion' },
    };
    expect(toolMode(agente, 'crear_checkout')).toBe('aprobacion');
    expect(toolNeedsApproval(agente, 'crear_checkout')).toBe(true);
  });

  it('las herramientas sin permiso viejo arrancan prendidas', () => {
    // Buscar en el catálogo o mirar la ficha de quien escribe no existían como
    // permiso: negarlas por defecto dejaría al agente peor que ayer.
    const viejo = { permissions: null };
    for (const k of ['buscar_producto', 'ver_producto', 'ver_contacto', 'lookup_order']) {
      expect(toolEnabled(viejo, k), k).toBe(true);
    }
  });

  it('una herramienta que no existe no está prendida', () => {
    expect(toolMode({}, 'lanzar_campana')).toBe('off');
    expect(toolEnabled({}, 'lanzar_campana')).toBe(false);
  });
});

describe('lo irreversible nunca queda en automático', () => {
  const IRREVERSIBLES = ['cancelar_pedido', 'reembolsar'];

  it('no ofrecen el modo automático', () => {
    for (const k of IRREVERSIBLES) {
      const spec = AGENT_TOOLBOX.find((t) => t.key === k);
      expect(spec?.modes, k).not.toContain('auto');
    }
  });

  it('un "auto" guardado a mano en la base NO manda', () => {
    // El agente lee mensajes de desconocidos: devolver dinero sin que nadie
    // mire no puede depender de que nadie haya editado la fila.
    for (const k of IRREVERSIBLES) {
      const agente = { tools: { [k]: 'auto' } };
      expect(toolMode(agente, k), k).toBe('aprobacion');
    }
  });

  it('la API descarta ese modo antes de escribirlo', () => {
    expect(sanitizeTools({ reembolsar: 'auto' })).toBeNull();
    expect(sanitizeTools({ cancelar_pedido: 'auto', reembolsar: 'off' })).toEqual({
      reembolsar: 'off',
    });
  });

  it('apagarlas sí se puede: quien no quiere confirmar, no las usa', () => {
    expect(toolMode({ tools: { reembolsar: 'off' } }, 'reembolsar')).toBe('off');
  });
});

describe('sanitizeTools', () => {
  it('descarta claves que no son herramientas', () => {
    expect(sanitizeTools({ campanas__lanzar: 'auto', agentes__crear: 'auto' })).toBeNull();
  });

  it('descarta modos inventados', () => {
    expect(sanitizeTools({ crear_checkout: 'siempre' })).toBeNull();
    expect(sanitizeTools({ crear_checkout: true })).toBeNull();
  });

  it('deja pasar lo válido y sólo eso', () => {
    expect(
      sanitizeTools({
        crear_checkout: 'aprobacion',
        basura: 'auto',
        reembolsar: 'auto',
        buscar_producto: 'off',
      }),
    ).toEqual({ crear_checkout: 'aprobacion', buscar_producto: 'off' });
  });

  it('no se rompe con lo que no es un objeto', () => {
    expect(sanitizeTools(null)).toBeNull();
    expect(sanitizeTools('auto')).toBeNull();
    expect(sanitizeTools(['crear_checkout'])).toBeNull();
  });
});

describe('el catálogo es coherente', () => {
  it('cada herramienta admite su propio respaldo', () => {
    // Un respaldo fuera de la lista de modos dejaría la fila mostrando algo
    // que el usuario no puede volver a elegir.
    for (const t of AGENT_TOOLBOX) {
      expect(t.modes, t.key).toContain(t.fallback);
    }
  });

  it('las claves no se repiten', () => {
    const claves = AGENT_TOOLBOX.map((t) => t.key);
    expect(new Set(claves).size).toBe(claves.length);
  });

  it('las que sólo se leen no ofrecen aprobación', () => {
    // Pedirle permiso a alguien para MIRAR un producto es una confirmación que
    // nadie va a contestar y una conversación que se traba.
    for (const k of ['buscar_producto', 'ver_producto', 'lookup_order', 'ver_contacto']) {
      const spec = AGENT_TOOLBOX.find((t) => t.key === k);
      expect(spec?.modes, k).not.toContain('aprobacion');
    }
  });
});
