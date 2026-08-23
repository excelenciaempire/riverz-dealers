import { describe, it, expect } from 'vitest';
import { SUFIJO } from './tool-switchboard';
import { AGENT_TOOLBOX, TOOL_GROUPS, TOOL_MODES } from '@/lib/ai/toolbox';
import { operation } from '@/lib/i18n/messages/operation';

/**
 * Que ninguna herramienta pueda quedar sin nombre en la pantalla.
 *
 * `translate` devuelve la clave cuando no la encuentra, así que una herramienta
 * sin traducción no falla: le muestra al comercio el texto crudo
 * `operation.toolno_se_la_respuesta` y nadie se entera hasta que alguien mira.
 * Eso fue exactamente lo que pasó con la número 18.
 *
 * El cruce va contra `AGENT_TOOLBOX`, que es la lista de verdad: sumar una
 * herramienta nueva y olvidar cualquiera de las cuatro piezas —sufijo, nombre y
 * ayuda, en los dos idiomas— rompe acá y no en producción.
 */

const catalogo = operation as Record<string, { es: string; en: string } | undefined>;

describe('la pizarra nombra todas las herramientas', () => {
  for (const spec of AGENT_TOOLBOX) {
    it(`${spec.key} tiene sufijo, nombre y ayuda en es y en`, () => {
      const sufijo = SUFIJO[spec.key];
      expect(sufijo, `falta ${spec.key} en SUFIJO`).toBeTruthy();

      for (const parte of ['', 'Hint']) {
        const clave = `tool${sufijo}${parte}`;
        const entrada = catalogo[clave];
        expect(entrada, `falta operation.${clave}`).toBeTruthy();
        expect(entrada!.es.trim(), `operation.${clave}.es vacío`).not.toBe('');
        expect(entrada!.en.trim(), `operation.${clave}.en vacío`).not.toBe('');
      }
    });
  }

  it('no sobra ningún sufijo apuntando a una herramienta que ya no existe', () => {
    const claves = new Set(AGENT_TOOLBOX.map((s) => s.key));
    expect(Object.keys(SUFIJO).filter((k) => !claves.has(k))).toEqual([]);
  });

  it('cada grupo y cada modo también están traducidos', () => {
    const GRUPO: Record<string, string> = {
      catalogo: 'Catalogo',
      venta: 'Venta',
      pedidos: 'Pedidos',
      postventa: 'Postventa',
      conversacion: 'Conversacion',
    };
    for (const g of TOOL_GROUPS) {
      expect(catalogo[`toolGroup${GRUPO[g]}`], `falta el grupo ${g}`).toBeTruthy();
    }
    for (const m of TOOL_MODES) {
      const sufijo = m === 'off' ? 'Off' : m === 'auto' ? 'Auto' : 'Aprobacion';
      expect(catalogo[`toolMode${sufijo}`], `falta el modo ${m}`).toBeTruthy();
    }
  });

  it('cada grupo tiene al menos una herramienta, o la pantalla muestra un título vacío', () => {
    for (const g of TOOL_GROUPS) {
      expect(AGENT_TOOLBOX.some((s) => s.group === g), `el grupo ${g} quedó vacío`).toBe(true);
    }
  });
});
