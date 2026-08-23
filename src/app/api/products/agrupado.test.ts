import { describe, it, expect } from 'vitest';

/**
 * Un producto vendido en varios lados se lista UNA vez.
 *
 * El caso real: el serum de Pilar tiene cuatro filas —la de Shopify y tres
 * publicaciones de Mercado Libre— y la pantalla las mostraba todas. El comercio
 * veía cuatro tarjetas del mismo producto y no tenía forma de saber cuál
 * editar: unificar la base sin unificar la lista deja el problema donde el
 * comercio lo mira.
 *
 * La lógica es la misma que corre en la ruta; se prueba acá porque lo que
 * importa es la regla, no el HTTP.
 */

interface Fila {
  id: string;
  title: string;
  master_id?: string | null;
  platform?: string;
  price_min?: number | null;
  currency?: string | null;
  url?: string | null;
}

/** El plegado tal cual está en `/api/products`. */
function agrupar(filas: Fila[]) {
  const porId = new Map(filas.map((p) => [String(p.id), p]));
  const hijosDe = new Map<string, Fila[]>();
  for (const p of filas) {
    const master = p.master_id ? String(p.master_id) : '';
    if (!master || !porId.has(master)) continue;
    hijosDe.set(master, [...(hijosDe.get(master) ?? []), p]);
  }
  return filas
    .filter((p) => !(p.master_id && porId.has(String(p.master_id))))
    .map((p) => {
      const hijos = hijosDe.get(String(p.id)) ?? [];
      if (hijos.length === 0) return p;
      return {
        ...p,
        listings: [p, ...hijos].map((x) => ({
          id: x.id,
          platform: x.platform ?? 'shopify',
          price_min: x.price_min ?? null,
          is_master: x.id === p.id,
        })),
      };
    });
}

const SHOP: Fila = {
  id: 'shop',
  title: 'Serum Pilar',
  platform: 'shopify',
  price_min: 39990,
  master_id: null,
};
const ML1: Fila = { id: 'ml1', title: 'Serum x1', platform: 'mercadolibre', price_min: 45000, master_id: 'shop' };
const ML2: Fila = { id: 'ml2', title: 'Serum x2', platform: 'mercadolibre', price_min: 75000, master_id: 'shop' };
const ML3: Fila = { id: 'ml3', title: 'Serum x3', platform: 'mercadolibre', price_min: 105000, master_id: 'shop' };
const BICI: Fila = { id: 'bici', title: 'Bicicleta', platform: 'mercadolibre', master_id: null };

describe('la lista de productos', () => {
  it('muestra el serum UNA vez, no cuatro', () => {
    const out = agrupar([SHOP, ML1, ML2, ML3]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('shop');
  });

  it('la tarjeta lleva sus cuatro canales con el precio de cada uno', () => {
    const [uno] = agrupar([SHOP, ML1, ML2, ML3]) as Array<
      Fila & { listings?: Array<{ id: string; price_min: number | null; is_master: boolean }> }
    >;
    expect(uno.listings).toHaveLength(4);
    expect(uno.listings?.filter((l) => l.is_master)).toHaveLength(1);
    expect(uno.listings?.map((l) => l.price_min).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([
      39990, 45000, 75000, 105000,
    ]);
  });

  it('lo que no está unificado sigue como estaba', () => {
    const out = agrupar([SHOP, ML1, BICI]);
    expect(out.map((p) => p.id).sort()).toEqual(['bici', 'shop']);
  });

  it('un producto solo no lleva la línea de canales', () => {
    const [uno] = agrupar([BICI]) as Array<Fila & { listings?: unknown }>;
    expect(uno.listings).toBeUndefined();
  });

  it('con un filtro que deja afuera a la principal, la publicación NO desaparece', () => {
    // Buscar "x2" trae la publicación y no su principal. Plegarla contra una
    // tarjeta que no está en la respuesta la haría invisible: el comercio
    // buscaría algo que existe y la pantalla le diría que no hay nada.
    const out = agrupar([ML2]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('ml2');
  });
});
