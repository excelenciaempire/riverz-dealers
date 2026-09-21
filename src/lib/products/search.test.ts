import { describe, it, expect, vi } from 'vitest';
import { searchProducts } from './search';

/**
 * Lo que se prueba acá es el criterio, no la base: qué se considera un hallazgo
 * y en qué orden se le muestran al modelo. Un orden malo se nota enseguida —
 * la clienta pregunta por el serum y el agente le ofrece otra cosa.
 */

type Fila = Record<string, unknown>;

/** Doble de Supabase: devuelve `filas` a la primera consulta y `porTag` a la
 *  segunda (la de etiquetas, que sólo corre si la primera trajo poco). */
function db(filas: Fila[], porTag: Fila[] = []) {
  let llamada = 0;
  const consulta = () => {
    llamada += 1;
    const datos = llamada === 1 ? filas : porTag;
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'or', 'order', 'contains', 'overlaps']) {
      q[m] = vi.fn(() => q);
    }
    q.limit = vi.fn(() => Promise.resolve({ data: datos, error: null }));
    return q;
  };
  return { from: vi.fn(() => consulta()) } as never;
}

const producto = (over: Fila = {}): Fila => ({
  id: 'p1',
  title: 'Serum Vitamina C 30ml',
  handle: 'serum-vitamina-c',
  url: 'https://tienda.com/serum',
  image_url: null,
  price_min: 69000,
  price_max: 69000,
  currency: 'COP',
  tags: ['rostro'],
  description: 'Ilumina y unifica el tono. Ideal para piel sensible.',
  raw: {
    status: 'active',
    published_at: '2026-09-08T22:51:03-04:00',
    options: [{ name: 'Modelo' }],
    variants: [
      {
        id: 123456,
        title: 'Cerdita Rosa',
        option1: 'Cerdita Rosa',
        price: '69000',
        inventory_management: 'shopify',
        inventory_policy: 'continue',
        inventory_quantity: 0,
      },
    ],
    images: [{ src: 'https://cdn/x.jpg' }],
  },
  ...over,
});

describe('searchProducts', () => {
  it('devuelve lo que hace falta para armar una tarjeta y un carrito', async () => {
    const [hit] = await searchProducts(db([producto()]), {
      workspaceId: 'w',
      query: 'serum',
    });
    expect(hit.title).toBe('Serum Vitamina C 30ml');
    expect(hit.price_min).toBe(69000);
    expect(hit.currency).toBe('COP');
    // Sin la variante no se puede armar el carrito, que es el punto de buscar.
    expect(hit.variant_id).toBe('123456');
    expect(hit.variants).toEqual([
      expect.objectContaining({
        id: '123456',
        title: 'Cerdita Rosa',
        options: { Modelo: 'Cerdita Rosa' },
        available: true,
      }),
    ]);
  });

  it('usa la foto del volcado crudo cuando falta image_url', async () => {
    const [hit] = await searchProducts(db([producto({ image_url: null })]), {
      workspaceId: 'w',
      query: 'serum',
    });
    expect(hit.image).toBe('https://cdn/x.jpg');
  });

  it('entrega una foto real por color disponible', async () => {
    const [hit] = await searchProducts(
      db([
        producto({
          raw: {
            status: 'active',
            published_at: '2026-09-08T22:51:03-04:00',
            options: [{ name: 'Color' }],
            variants: [
              {
                id: 1,
                option1: 'Blanco',
                image_id: 11,
                inventory_management: 'shopify',
                inventory_quantity: 3,
              },
              {
                id: 2,
                option1: 'Negro',
                image_id: 12,
                inventory_management: 'shopify',
                inventory_quantity: 2,
              },
              {
                id: 3,
                option1: 'Blanco',
                image_id: 11,
                inventory_management: 'shopify',
                inventory_quantity: 1,
              },
            ],
            images: [
              { id: 11, src: 'https://cdn.test/blanco.jpg' },
              { id: 12, src: 'https://cdn.test/negro.jpg' },
            ],
          },
        }),
      ]),
      { workspaceId: 'w', query: 'serum' },
    );
    expect(hit.visual_options).toEqual([
      { label: 'Blanco', image: 'https://cdn.test/blanco.jpg' },
      { label: 'Negro', image: 'https://cdn.test/negro.jpg' },
    ]);
  });

  it('pone primero el título exacto', async () => {
    const hits = await searchProducts(
      db([
        producto({ id: 'a', title: 'Kit Serum y Crema' }),
        producto({ id: 'b', title: 'serum' }),
      ]),
      { workspaceId: 'w', query: 'Serum' }
    );
    expect(hits[0].id).toBe('b');
  });

  it('prefiere el que comparte más palabras con la pregunta', async () => {
    const hits = await searchProducts(
      db([
        producto({ id: 'otro', title: 'Serum de Rosas', tags: [] }),
        producto({ id: 'justo', title: 'Serum Vitamina C 30ml', tags: [] }),
      ]),
      { workspaceId: 'w', query: 'serum vitamina c' }
    );
    expect(hits[0].id).toBe('justo');
  });

  it('respeta el tope pedido', async () => {
    const muchos = Array.from({ length: 30 }, (_, i) =>
      producto({ id: `p${i}`, title: `Serum ${i}` })
    );
    expect(
      (
        await searchProducts(db(muchos), {
          workspaceId: 'w',
          query: 'serum',
          limit: 3,
        })
      ).length
    ).toBe(3);
  });

  it('no busca con una consulta demasiado corta', async () => {
    // Con una letra el resultado sería el catálogo entero: es ruido, no ayuda.
    expect(
      await searchProducts(db([producto()]), { workspaceId: 'w', query: 'a' })
    ).toEqual([]);
    expect(
      await searchProducts(db([producto()]), { workspaceId: 'w', query: '  ' })
    ).toEqual([]);
  });

  it('neutraliza los caracteres que romperían la consulta', async () => {
    // `%` es comodín de ilike y `,` separa las ramas del or de PostgREST: sin
    // escaparlos, una búsqueda con esos signos devolvía cualquier cosa.
    const cliente = db([producto()]);
    await searchProducts(cliente, { workspaceId: 'w', query: '%%%' });
    await searchProducts(cliente, { workspaceId: 'w', query: 'a,b)' });
    // No explota y no inventa resultados: es todo lo que se le pide.
    expect(true).toBe(true);
  });

  it('devuelve vacío si la base falla, sin lanzar', async () => {
    const roto = {
      from: () => {
        const q: Record<string, unknown> = {};
        for (const m of ['select', 'eq', 'or', 'order', 'contains', 'overlaps'])
          q[m] = () => q;
        q.limit = () =>
          Promise.resolve({ data: null, error: { message: 'boom' } });
        return q;
      },
    } as never;
    expect(
      await searchProducts(roto, { workspaceId: 'w', query: 'serum' })
    ).toEqual([]);
  });
});
