import type { SupabaseClient } from '@supabase/supabase-js';
import { agruparPorPrincipal, type FilaAgrupable } from '@/lib/products/agrupar';
import {
  authorizedPrices,
  withoutHistoricalPriceLines,
} from '@/lib/products/price-integrity';
import { refreshLivePricing } from '@/lib/shopify/live-pricing';

/**
 * EL CEREBRO DEL PRODUCTO en los mensajes proactivos.
 *
 * El núcleo de Riverz es que el producto es la fuente de conocimiento que
 * alimenta todo. El Asistente ya lo cumplía: cuando alguien escribe, detecta de
 * qué producto habla y le mete su investigación, sus guías de qué decir, lo que
 * NUNCA debe afirmar, sus ofertas válidas y cuándo escalar.
 *
 * Los mensajes PROACTIVOS —el piso de comentarios y las campañas— solo tenían
 * el TÍTULO y el enlace. Por eso podían prometer una aprobación sanitaria o
 * inventarse un precio: no es que el conocimiento no existiera, es que no
 * llegaba hasta ahí. Esto lo conecta.
 *
 * Devuelve el bloque listo para el prompt, con las mismas reglas que el
 * Asistente aplica: no inventar ofertas, no afirmar lo prohibido, escalar
 * cuando toca.
 */

export interface ProductBrain {
  /** Bloque para el prompt (conocimiento + reglas del producto). */
  brief: string;
  /** Título del producto detectado, para el resto del mensaje. */
  title: string;
  url: string | null;
  /** Producto delicado (salud): el redactor debe ser aún más prudente. */
  healthSensitive: boolean;
  /** Precios comprobados que pueden pasar la última puerta antes de publicar. */
  authorizedPriceValues: number[];
  /** En una pregunta de precio, false obliga a dejar el comentario a una persona. */
  pricingVerified: boolean;
}

interface ProductRow {
  id: string;
  title: string;
  handle: string | null;
  description: string | null;
  url: string | null;
  price_min: number | null;
  price_max: number | null;
  currency: string | null;
  training_material: string | null;
  say_guidelines: string | null;
  never_say: unknown[] | null;
  escalation_triggers: unknown[] | null;
  allowed_offers: unknown[] | null;
  health_sensitive: boolean | null;
  master_id?: string | null;
  platform?: string | null;
}

const FIELDS =
  'id, title, handle, description, url, price_min, price_max, currency, training_material, say_guidelines, never_say, escalation_triggers, allowed_offers, health_sensitive, master_id, platform';

function asStrings(v: unknown[] | null | undefined): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === 'string' ? x : ''))
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Todos los nombres con los que se conoce a este producto.
 *
 * El del marketplace es el que se parece a lo que escribe la gente —"serum
 * reafirmante antiedad"— y el de la tienda es el que manda. Al plegar quedaba
 * sólo el segundo, así que un producto podía no reconocerse por el nombre con
 * el que se lo nombra.
 */
function titulosDe(p: { title: string; listings?: Array<{ title: string | null }> }): string[] {
  const otros = p.listings ?? [];
  return [p.title, ...otros.map((l) => l.title ?? '')].filter(Boolean);
}

function normalizeProductText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\breferencia\s+(?:n(?:o|umero)?\.?\s*)?(\d+)\b/g, 'ref $1')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** ¿De qué producto habla? Match por título, handle y palabras distintivas. */
export function pickProduct<T extends {
  title: string;
  handle?: string | null;
  listings?: Array<{ title: string | null }>;
}>(rows: T[], text: string): T | null {
  const hay = normalizeProductText(text);
  if (!hay.trim()) return null;
  // El handle conserva referencias cortas que el título escribe de otra forma:
  // `ref-4` debe encontrar "Referencia No. 4" en el caption del post.
  const exact = rows.find((p) =>
    [...titulosDe(p), p.handle ?? '']
      .map(normalizeProductText)
      .filter((alias) => alias.length >= 3)
      .some((alias) => hay.includes(alias)),
  );
  if (exact) return exact;
  // Después, cualquier palabra distintiva (>4 letras) permite que "el serum"
  // encuentre "Serum Pilar".
  return (
    rows.find((p) =>
      normalizeProductText(titulosDe(p).join(' '))
        .split(/\s+/)
        .filter((w) => w.length > 4)
        .some((w) => hay.includes(w)),
    ) ?? null
  );
}

/**
 * Conocimiento del producto del que habla esta persona. Si no se identifica
 * ninguno, cae al que la campaña quiere destacar; y si tampoco, null (el
 * mensaje sale con el catálogo genérico, como antes).
 */
export async function loadProductBrain(
  db: SupabaseClient,
  workspaceId: string,
  opts: { text?: string | null; preferTitles?: string[]; verifyPricing?: boolean },
): Promise<ProductBrain | null> {
  try {
    const { data } = await db
      .from('shopify_products')
      .select(FIELDS)
      .eq('workspace_id', workspaceId)
      .limit(100);
    // Un producto vendido en varios lados es UNO, y el conocimiento vive en la
    // principal. Sin plegar, "el serum" podía caer en la publicación de Mercado
    // Libre —que tiene el título más parecido a lo que escribe la gente y el
    // `training_material` vacío, porque nadie carga la misma ficha cuatro
    // veces— y el mensaje salía sin nada del cerebro que este archivo existe
    // para conectar.
    const rows = agruparPorPrincipal(
      (data ?? []) as unknown as FilaAgrupable[],
    ) as unknown as ProductRow[];
    if (rows.length === 0) return null;

    const preferred = (opts.preferTitles ?? [])
      .map((t) => rows.find((p) => p.title.toLowerCase() === t.toLowerCase()))
      .find(Boolean);
    let product =
      pickProduct(rows, opts.text ?? '') ??
      preferred ??
      // Catálogo de un solo producto: es evidente de cuál se habla.
      (rows.length === 1 ? rows[0] : null);
    if (!product) return null;

    let pricingVerified = !opts.verifyPricing;
    if (opts.verifyPricing) {
      const fresh = await refreshLivePricing(db, product.id);
      pricingVerified = fresh.ok;
      if (fresh.ok) {
        // La composición que sigue tiene que usar la misma foto que acabamos de
        // verificar, no el objeto leído antes del fetch.
        const { data: refreshed } = await db
          .from('shopify_products')
          .select(FIELDS)
          .eq('id', product.id)
          .maybeSingle();
        if (refreshed) product = refreshed as ProductRow;
      }
    }

    const parts: string[] = [`PRODUCTO DEL QUE HABLA: ${product.title}`];
    if (product.price_min != null) {
      const cur = product.currency ?? '';
      parts.push(
        product.price_max != null && product.price_max !== product.price_min
          ? `- Precio: ${product.price_min}-${product.price_max} ${cur}`
          : `- Precio: ${product.price_min} ${cur}`,
      );
    }
    if (product.url) parts.push(`- Enlace: ${product.url}`);
    if (product.description?.trim()) {
      parts.push(`- Qué es: ${product.description.trim().slice(0, 400)}`);
    }
    if (product.training_material?.trim()) {
      parts.push(
        `- Lo que sabemos de él:\n${withoutHistoricalPriceLines(product.training_material).slice(0, 1200)}`,
      );
    }
    if (product.say_guidelines?.trim()) {
      parts.push(`- Enfatiza: ${product.say_guidelines.trim()}`);
    }

    // Las mismas barreras que aplica el Asistente. Esto es lo que evita que un
    // modelo de respaldo se invente una aprobación sanitaria o un precio.
    const offers = product.allowed_offers;
    const offerLines = Array.isArray(offers)
      ? offers
          .map((o) => {
            if (o && typeof o === 'object') {
              const r = o as Record<string, unknown>;
              const label = typeof r.label === 'string' ? r.label : '';
              const total = r.total != null ? `: ${r.total}` : '';
              return label ? `  · ${label}${total}` : '';
            }
            return typeof o === 'string' ? `  · ${o}` : '';
          })
          .filter(Boolean)
      : [];
    if (offerLines.length) {
      parts.push(`- Ofertas válidas (NO inventes otras):\n${offerLines.join('\n')}`);
    }
    const never = asStrings(product.never_say);
    if (never.length) {
      parts.push(`- NUNCA afirmes: ${never.join('; ')}.`);
    }
    const esc = asStrings(product.escalation_triggers);
    if (esc.length) {
      parts.push(
        `- Si menciona ${esc.join('; ')}: no resuelvas tú, dile que lo ve una persona del equipo.`,
      );
    }
    if (product.health_sensitive) {
      parts.push(
        '- Producto delicado: nada de promesas de resultados, plazos ni efectos en la salud.',
      );
    }

    return {
      brief: parts.join('\n'),
      title: product.title,
      url: product.url,
      healthSensitive: product.health_sensitive === true,
      authorizedPriceValues: authorizedPrices([product]),
      pricingVerified,
    };
  } catch {
    return null;
  }
}
