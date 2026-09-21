import type { SupabaseClient } from '@supabase/supabase-js';
import {
  agruparPorPrincipal,
  type Agrupado,
  type FilaAgrupable,
} from '@/lib/products/agrupar';
import { unidadesDelTitulo } from '@/lib/products/unify';
import {
  shopifyCatalogVariants,
  type CatalogVariant,
} from '@/lib/products/variants';

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
  /** Todas las variantes publicadas y su disponibilidad; nunca sólo la primera. */
  variants: CatalogVariant[];
  /** Una foto real por opción visual principal (por ejemplo, cada color). */
  visual_options: Array<{ label: string; image: string }>;
  /** Recorte de la descripción, para que el modelo sepa de qué se trata. */
  summary: string;
  /**
   * Dónde más se vende lo mismo, con el precio de cada canal. Vacío cuando el
   * producto está en un solo lado. Los precios no se promedian: el mismo serum
   * sale 39.990 en la tienda y 45.000 en el marketplace por las comisiones, y
   * los dos son ciertos donde están.
   */
  listings?: Array<{
    platform: string;
    price: number | null;
    currency: string | null;
    /** Cuántas unidades entran en ese precio: en un marketplace el x2 es una
     *  publicación aparte, y sin esto el agente lee tres precios del mismo
     *  producto y no sabe que el segundo son dos frascos. */
    units: number;
  }>;
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
  raw: {
    status?: unknown;
    published_at?: unknown;
    options?: unknown;
    variants?: Array<{
      id?: number | string;
      option1?: unknown;
      image_id?: unknown;
      inventory_management?: unknown;
      inventory_policy?: unknown;
      inventory_quantity?: unknown;
    }>;
    images?: Array<{ id?: unknown; src?: string; alt?: unknown }>;
  } | null;
  /** La fila que manda cuando el producto se vende en varias plataformas. */
  master_id?: string | null;
  platform?: string | null;
}

/** Una sola lista de columnas: las dos consultas tienen que traer lo mismo, o
 *  la segunda devuelve filas sin `master_id` y esas no se pliegan. */
const COLUMNAS =
  'id, title, handle, url, image_url, price_min, price_max, currency, tags, description, raw, master_id, platform';

/** Quita tildes y baja a minúsculas: así es como la gente escribe al preguntar. */
function plano(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
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
  args: {
    workspaceId: string;
    query: string;
    limit?: number;
    /**
     * Los productos que este agente puede nombrar. `null`/ausente = todos.
     *
     * Sin esto, un agente con "Productos asignados" buscaba en el catálogo
     * ENTERO: el comercio le decía de qué puede hablar y la herramienta que más
     * usa se lo saltaba. Se pasa ya expandido al grupo (`expandirGrupos`), así
     * que autorizar un producto autoriza sus publicaciones.
     */
    permitidos?: Set<string> | null;
    /**
     * Plegar las publicaciones del mismo producto en una.
     *
     * Lo piden `buscar_producto` y `ver_producto`: sin esto, "serum" devolvía
     * las cuatro filas del serum de Pilar con cuatro precios distintos, y el
     * agente contestaba que "cuesta entre 39.990 y 105.000" — que no es un
     * precio. NO lo pide la verificación de precios de un cobro: ahí importa la
     * fila exacta que se está cotizando.
     */
    agrupar?: boolean;
  }
): Promise<ProductHit[]> {
  const q = plano(args.query).slice(0, 120);
  if (q.length < 2) return [];
  const limite = Math.min(Math.max(args.limit ?? 6, 1), 20);

  // Alcance específico y nada asignado: no hay catálogo del que hablar. Sin
  // este corte, un `Set` vacío se leía como "sin restricción" y el agente
  // buscaba en todo.
  const permitidos = args.permitidos ?? null;
  if (permitidos && permitidos.size === 0) return [];
  // Por encima de doscientos la lista no entra cómoda en una URL, y a esa
  // altura "específico" ya es prácticamente todo el catálogo: se filtra en
  // memoria, más abajo.
  const acotar =
    permitidos && permitidos.size <= 200 ? Array.from(permitidos) : null;

  // `%` es un comodín de `ilike`, y `,` separa las ramas del `.or()` de
  // PostgREST: sin escaparlos, una búsqueda con esos caracteres devolvía
  // cualquier cosa o rompía la consulta entera.
  //
  // `*` va en la misma lista: PostgREST lo traduce a `%` dentro de `like` e
  // `ilike`, así que se colaba como comodín aunque el `%` estuviera tapado, y
  // una pregunta con un asterisco devolvía catálogo indiscriminado.
  const seguro = q.replace(/[%*,()]/g, ' ').trim();
  if (!seguro) return [];

  // Se traen de más porque después se recorta: al plegar, cuatro filas del
  // mismo producto quedan en una, y pedir justo `limite` devolvía menos
  // productos de los que el catálogo tiene para ofrecer.
  const traer = limite * (args.agrupar ? 5 : 3);

  let base = db
    .from('shopify_products')
    .select(COLUMNAS)
    .eq('workspace_id', args.workspaceId)
    .or(`title.ilike.%${seguro}%,description.ilike.%${seguro}%`)
    // Los más recientes primero: si hay empate, gana lo que el comercio
    // sincronizó último, que suele ser lo que está vendiendo ahora.
    .order('synced_at', { ascending: false })
    .limit(traer);
  if (acotar) base = base.in('id', acotar);
  const { data, error } = await base;
  if (error) return [];

  const filas = (data ?? []) as Row[];
  // Las que coincidieron con la frase entera entran sí o sí: pueden haber
  // coincidido por la descripción, que no puntúa, y descartarlas por eso sería
  // perder justo la búsqueda por "para qué sirve".
  const deFrase = new Set(filas.map((f) => f.id));

  // Las etiquetas van en una segunda consulta porque son un array y no entran
  // en el mismo `or` de texto. Sólo si la primera trajo poco: la mayoría de las
  // preguntas se resuelven por nombre y no vale un viaje extra.
  if (filas.length < limite) {
    // Por PALABRA, no por la pregunta entera. `contains(['algo para piel
    // sensible'])` exige una etiqueta escrita exactamente así, que no existe en
    // ningún catálogo: la rama que este bloque promete —encontrar por
    // etiqueta— no acertaba nunca, ni siquiera cuando la persona escribía el
    // nombre de una etiqueta y algo más.
    const palabras = seguro
      .split(/\s+/)
      .filter((t) => t.length > 2)
      .slice(0, 4);
    if (palabras.length > 1) {
      // Y por cada palabra en el TÍTULO, en cualquier orden.
      //
      // La frase entera exige que estén como las escribió: "serum antiedad x2"
      // no encontraba "Serum 30 Ml X2 Antiedad", el mismo producto tal como lo
      // titula un marketplace. La clienta escribe en el orden que se le ocurre
      // y recibía "no lo tenemos". Va después de la frase, no en su lugar: la
      // coincidencia exacta sigue ganando por puntaje.
      let porPalabra = db
        .from('shopify_products')
        .select(COLUMNAS)
        .eq('workspace_id', args.workspaceId)
        .or(palabras.map((w) => `title.ilike.%${w}%`).join(','))
        .order('synced_at', { ascending: false })
        .limit(traer);
      if (acotar) porPalabra = porPalabra.in('id', acotar);
      const { data: sueltas } = await porPalabra;
      for (const f of (sueltas ?? []) as Row[]) {
        if (!filas.some((x) => x.id === f.id)) filas.push(f);
      }
    }
    if (palabras.length > 0) {
      let porTags = db
        .from('shopify_products')
        .select(COLUMNAS)
        .eq('workspace_id', args.workspaceId)
        .overlaps('tags', palabras)
        .limit(traer);
      if (acotar) porTags = porTags.in('id', acotar);
      const { data: porTag } = await porTags;
      for (const f of (porTag ?? []) as Row[]) {
        if (!filas.some((x) => x.id === f.id)) filas.push(f);
      }
    }
  }

  // Lo que este agente puede nombrar. Se filtra también acá y no sólo en la
  // consulta: la segunda búsqueda por etiqueta agrega filas por su cuenta.
  const visibles = permitidos
    ? filas.filter((f) => permitidos.has(f.id))
    : filas;

  // Las principales que la búsqueda no trajo.
  //
  // Quien pregunta escribe el nombre del marketplace —"serum reafirmante
  // antiedad"— y ése es el título de la PUBLICACIÓN, no el de la fila que manda.
  // Sin traerla, el agente se quedaba con la publicación: precio del
  // marketplace y `training_material` vacío, porque nadie carga la misma ficha
  // cuatro veces. O sea, encontraba el producto y perdía lo que sabe de él.
  if (args.agrupar) {
    const presentes = new Set(visibles.map((f) => f.id));
    const faltan = Array.from(
      new Set(
        visibles
          .map((f) => f.master_id)
          .filter(
            (m): m is string =>
              !!m && !presentes.has(m) && (!permitidos || permitidos.has(m))
          )
      )
    ).slice(0, 50);
    if (faltan.length > 0) {
      const { data: principales } = await db
        .from('shopify_products')
        .select(COLUMNAS)
        .eq('workspace_id', args.workspaceId)
        .in('id', faltan);
      visibles.push(...((principales ?? []) as Row[]));
    }
  }

  // Un producto vendido en varios lados es UNO. Sin esto, "serum" devolvía las
  // cuatro filas del serum de Pilar con cuatro precios distintos y el agente
  // contestaba que "cuesta entre 39.990 y 105.000", que no es un precio.
  const agrupadas = args.agrupar
    ? agruparPorPrincipal(visibles as unknown as FilaAgrupable[])
    : (visibles as unknown as Array<Agrupado<FilaAgrupable>>);

  const tokens = seguro.split(/\s+/).filter((t) => t.length > 2);
  const puntajeDe = (titulo: string, tags: string[]): number => {
    const t = plano(titulo);
    if (t === seguro) return 1000;
    if (t.includes(seguro)) return 500;
    // Cuántas palabras de la pregunta aparecen en el título: es lo que separa
    // "serum vitamina c" de un producto que sólo comparte la palabra "serum".
    const enTitulo = tokens.filter((x) => t.includes(x)).length;
    const enTags = tokens.filter((x) =>
      tags.some((g) => plano(g).includes(x))
    ).length;
    return enTitulo * 10 + enTags * 3;
  };
  // Puntúa por el MEJOR de sus títulos. El del marketplace es el que se parece
  // a lo que escribe la clienta —"serum reafirmante x2"— y el de la tienda, el
  // que manda: puntuar sólo por el segundo dejaba el producto afuera de su
  // propia búsqueda.
  const puntaje = (f: Agrupado<FilaAgrupable>): number => {
    const tags = ((f as unknown as Row).tags ?? []) as string[];
    const titulos = [
      f.title ?? '',
      ...(f.listings ?? []).map((l) => l.title ?? ''),
    ];
    return Math.max(...titulos.map((t) => puntajeDe(t, tags)));
  };

  // Las que entraron por una palabra suelta tienen que ganárselo: buscar
  // "algo para piel sensible" traía cualquier título con "para" adentro, y
  // ofrecerle a alguien un producto que no tiene nada que ver es peor que
  // decirle que no hay.
  return agrupadas
    .filter((f) => deFrase.has(String(f.id)) || puntaje(f) > 0)
    .sort((a, b) => puntaje(b) - puntaje(a))
    .slice(0, limite)
    .map((g) => {
      const f = g as unknown as Row & {
        listings?: Agrupado<FilaAgrupable>['listings'];
      };
      return {
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
          f.raw?.variants?.[0]?.id != null
            ? String(f.raw.variants[0].id)
            : null,
        variants:
          (f.platform ?? 'shopify') === 'shopify'
            ? shopifyCatalogVariants(f.raw)
            : [],
        visual_options: visualOptions(f.raw),
        summary: (f.description ?? '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 200),
        // Dónde más se vende y a cuánto. El precio de cada canal es distinto y
        // los dos son ciertos: el agente necesita el del canal por el que le
        // están escribiendo.
        listings: (g.listings ?? []).map((l) => ({
          platform: l.platform,
          price: num(l.price_min),
          currency: l.currency,
          units: unidadesDelTitulo(l.title ?? ''),
        })),
      };
    });
}

/** Relaciona la primera opción de Shopify con su imagen de variante. */
function visualOptions(raw: Row['raw']): Array<{ label: string; image: string }> {
  const variants = Array.isArray(raw?.variants) ? raw.variants : [];
  const images = Array.isArray(raw?.images) ? raw.images : [];
  const imageById = new Map(
    images
      .filter((image) => image?.id != null && typeof image.src === 'string')
      .map((image) => [String(image.id), image.src!.trim()]),
  );
  const seen = new Set<string>();
  const options: Array<{ label: string; image: string }> = [];
  for (const variant of variants) {
    const label = String(variant.option1 ?? '').trim();
    const image = imageById.get(String(variant.image_id ?? '')) ?? '';
    const quantity = Number(variant.inventory_quantity ?? 0);
    const available =
      !String(variant.inventory_management ?? '').trim() ||
      quantity > 0 ||
      String(variant.inventory_policy ?? '').toLowerCase() === 'continue';
    const key = label.toLocaleLowerCase();
    if (!label || !image || !available || seen.has(key)) continue;
    seen.add(key);
    options.push({ label, image });
  }
  return options.slice(0, 8);
}
