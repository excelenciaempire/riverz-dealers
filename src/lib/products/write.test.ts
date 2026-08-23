import { describe, it, expect } from 'vitest';
import { actualizarProducto } from './write';

/**
 * Agregar una fuente tiene que volver a leerla.
 *
 * Antes se guardaba la URL y no pasaba absolutamente nada: `scraped_content`
 * seguía siendo el de la lectura vieja, el agente seguía sin saber, y la única
 * forma de enterarse era encontrar el botón de leer — después de haber
 * guardado, que es cuando uno cree que ya terminó. Es exactamente la mitad de
 * "que se pueda agregar más información" que no funcionaba.
 *
 * `fuentesCambiaron` es lo que la ruta mira para dispararlo.
 */

interface Doble {
  db: never;
  guardado: Record<string, unknown> | null;
}

function db(actual: Record<string, unknown>): Doble {
  let guardado: Record<string, unknown> | null = null;
  const cliente = {
    from() {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'or']) q[m] = () => q;
      q.maybeSingle = async () => ({ data: guardado ?? actual, error: null });
      q.update = (patch: Record<string, unknown>) => {
        guardado = { ...actual, ...patch };
        const fin: Record<string, unknown> = {
          maybeSingle: async () => ({ data: guardado, error: null }),
        };
        fin.eq = () => fin;
        fin.select = () => fin;
        return fin;
      };
      return q;
    },
  };
  return {
    db: cliente as never,
    get guardado() {
      return guardado;
    },
  } as Doble;
}

const base = {
  id: 'p1',
  workspace_id: 'w1',
  shop_domain: 'demo.myshopify.com',
  external_id: 123,
  title: 'Serum',
  url: 'https://tienda.com/serum',
  websites: ['https://tienda.com/serum'],
  scraped_content: 'lo que decía la página vieja',
};

describe('actualizarProducto — fuentes', () => {
  it('avisa cuando se AGREGA una fuente', async () => {
    const d = db(base);
    const r = await actualizarProducto(d.db, {
      id: 'p1',
      cambios: { websites: ['https://tienda.com/serum', 'https://blog.com/serum'] },
      locale: 'es',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.fuentesCambiaron).toBe(true);
  });

  it('avisa cuando se SACA una fuente', async () => {
    const d = db({ ...base, websites: ['https://a.com', 'https://b.com'] });
    const r = await actualizarProducto(d.db, {
      id: 'p1',
      cambios: { websites: ['https://a.com'] },
      locale: 'es',
    });
    if (r.ok) expect(r.fuentesCambiaron).toBe(true);
  });

  it('reordenar NO es un cambio', async () => {
    // Volver a leer cinco páginas porque alguien arrastró una fila es gastar
    // tiempo y cuota de Firecrawl para llegar al mismo texto.
    const d = db({ ...base, websites: ['https://a.com', 'https://b.com'] });
    const r = await actualizarProducto(d.db, {
      id: 'p1',
      cambios: { websites: ['https://b.com', 'https://a.com'] },
      locale: 'es',
    });
    if (r.ok) expect(r.fuentesCambiaron).toBe(false);
  });

  it('guardar OTRA cosa no dispara una lectura', async () => {
    const d = db(base);
    const r = await actualizarProducto(d.db, {
      id: 'p1',
      cambios: { custom_notes: 'viene en dos tamaños' },
      locale: 'es',
    });
    if (r.ok) expect(r.fuentesCambiaron).toBe(false);
  });

  it('lo que el comercio agrega llega al material del agente', async () => {
    // Si esto se rompe, el comercio escribe la información y el agente nunca
    // la ve: el campo se guarda y no sirve para nada.
    const d = db(base);
    const r = await actualizarProducto(d.db, {
      id: 'p1',
      cambios: {
        custom_notes: 'No apto para embarazadas',
        custom_faqs: [{ q: '¿Sirve para piel sensible?', a: 'Sí, está testeado.' }],
      },
      locale: 'es',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const material = String(r.producto.training_material ?? '');
      expect(material).toContain('No apto para embarazadas');
      expect(material).toContain('piel sensible');
      // Y lo leído de la página sigue estando: agregar no reemplaza.
      expect(material).toContain('la página vieja');
    }
  });
});
