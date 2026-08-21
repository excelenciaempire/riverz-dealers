import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Buscar en el catálogo, para el agente.
 *
 * Existe porque el agente sólo conocía los productos que entraban en su prompt
 * —ochenta— y con un catálogo más grande el resto no existía: no lo podía
 * recomendar ni cotizar, y ni siquiera sabía que estaba a la venta. Subir ese
 * número no arregla nada: el prompt tiene un techo, y meterle mil productos
 * empeora TODAS las respuestas, no sólo las de catálogo. Lo que hacía falta era
 * poder buscar en vez de memorizar.
 *
 * Contra la tabla local y no contra la API de la tienda, por tres razones: es
 * instantáneo (índices trigram, migración 175), sirve igual para Shopify,
 * Tiendanube, WooCommerce y Mercado Libre, y no gasta una llamada a la
 * plataforma en medio de una conversación.
 */

export interface ProductHit {
  id: string;
  title: string;
  handle: string | null;
  url: string | null;
  image: string | null;
  price_min: number | null;
  price_max: number | null;
  currency: string | null;
  tags: string[];
  /** Primera variante: es lo que hace falta para armar un carrito. */
  variant_id: string | null;
  /** Recorte de la descripción, para que el modelo sepa de qué se trata. */
  summary: string;
}

interface Row {
  id: string;
  title: string | null;
  handle: string | null;
  url: string | null;
  image_url: string | null;
  price_min: number | string | null;
  price_max: number | string | null;
  currency: string | null;
  tags: string[] | null;
  description: string | null;
  raw: { variants?: Array<{ id?: number | string }>; images?: Array<{ src?: string }> } | null;
}

/** Quita tildes y baja a minúsculas: así es como la gente escribe al preguntar. */
function plano(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Los productos que mejor responden a lo que preguntaron.
 *
 * Busca por nombre, por descripción y por etiqueta a la vez: quien no sabe cómo
 * se llama el producto lo describe ("algo para piel sensible") o lo agrupa
 * ("regalo"), y las tres formas son igual de legítimas.
 */
export async function searchProducts(
  db: SupabaseClient,
  args: { workspaceId: string; query: string; limit?: number },
): Promise<ProductHit[]> {
  const q = plano(args.query).slice(0, 120);
  if (q.length < 2) return [];
  const limite = Math.min(Math.max(args.limit ?? 6, 1), 20);

  // `%` es un comodín de `ilike`, y `,` separa las ramas del `.or()` de
  // PostgREST: sin escaparlos, una búsqueda con esos caracteres devolvía
  // cualquier cosa o rompía la consulta entera.
  //
  // `*` va en la misma lista: PostgREST lo traduce a `%` dentro de `like` e
  // `ilike`, así que se colaba como comodín aunque el `%` estuviera tapado, y
  // una pregunta con un asterisco devolvía catálogo indiscriminado.
  const seguro = q.replace(/[%*,()]/g, ' ').trim();
  if (!seguro) return [];

  const { data, error } = await db
    .from('shopify_products')
    .select(
      'id, title, handle, url, image_url, price_min, price_max, currency, tags, description, raw',
    )
    .eq('workspace_id', args.workspaceId)
    .or(`title.ilike.%${seguro}%,description.ilike.%${seguro}%`)
    // Los más recientes primero: si hay empate, gana lo que el comercio
    // sincronizó último, que suele ser lo que está vendiendo ahora.
    .order('synced_at', { ascending: false })
    .limit(limite * 3);
  if (error) return [];

  const filas = (data ?? []) as Row[];

  // Las etiquetas van en una segunda consulta porque son un array y no entran
  // en el mismo `or` de texto. Sólo si la primera trajo poco: la mayoría de las
  // preguntas se resuelven por nombre y no vale un viaje extra.
  if (filas.length < limite) {
    // Por PALABRA, no por la pregunta entera. `contains(['algo para piel
    // sensible'])` exige una etiqueta escrita exactamente así, que no existe en
    // ningún catálogo: la rama que este bloque promete —encontrar por
    // etiqueta— no acertaba nunca, ni siquiera cuando la persona escribía el
    // nombre de una etiqueta y algo más.
    const palabras = seguro.split(/\s+/).filter((t) => t.length > 2).slice(0, 4);
    if (palabras.length > 0) {
      const { data: porTag } = await db
        .from('shopify_products')
        .select(
          'id, title, handle, url, image_url, price_min, price_max, currency, tags, description, raw',
        )
        .eq('workspace_id', args.workspaceId)
        .overlaps('tags', palabras)
        .limit(limite);
      for (const f of (porTag ?? []) as Row[]) {
        if (!filas.some((x) => x.id === f.id)) filas.push(f);
      }
    }
  }

  const tokens = seguro.split(/\s+/).filter((t) => t.length > 2);
  const puntaje = (f: Row): number => {
    const titulo = plano(f.title ?? '');
    if (titulo === seguro) return 1000;
    if (titulo.includes(seguro)) return 500;
    // Cuántas palabras de la pregunta aparecen en el título: es lo que separa
    // "serum vitamina c" de un producto que sólo comparte la palabra "serum".
    const enTitulo = tokens.filter((t) => titulo.includes(t)).length;
    const enTags = tokens.filter((t) =>
      (f.tags ?? []).some((g) => plano(g).includes(t)),
    ).length;
    return enTitulo * 10 + enTags * 3;
  };

  return filas
    .sort((a, b) => puntaje(b) - puntaje(a))
    .slice(0, limite)
    .map((f) => ({
      id: f.id,
      title: f.title ?? '',
      handle: f.handle,
      url: f.url,
      image: f.image_url || f.raw?.images?.[0]?.src || null,
      price_min: num(f.price_min),
      price_max: num(f.price_max),
      currency: f.currency,
      tags: f.tags ?? [],
      variant_id:
        f.raw?.variants?.[0]?.id != null ? String(f.raw.variants[0].id) : null,
      summary: (f.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
    }));
}
