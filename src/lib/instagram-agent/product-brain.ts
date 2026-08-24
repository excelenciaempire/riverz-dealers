import type { SupabaseClient } from '@supabase/supabase-js';
import { agruparPorPrincipal, type FilaAgrupable } from '@/lib/products/agrupar';

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
}

interface ProductRow {
  id: string;
  title: string;
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
  'id, title, description, url, price_min, price_max, currency, training_material, say_guidelines, never_say, escalation_triggers, allowed_offers, health_sensitive, master_id, platform';

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
function titulosDe(p: ProductRow): string[] {
  const otros = (p as { listings?: Array<{ title: string | null }> }).listings ?? [];
  return [p.title, ...otros.map((l) => l.title ?? '')].filter(Boolean);
}

/** ¿De qué producto habla? Match por título/palabras contra lo que escribió. */
function pickProduct(rows: ProductRow[], text: string): ProductRow | null {
  const hay = text.toLowerCase();
  if (!hay.trim()) return null;
  // Título completo primero; luego cualquier palabra distintiva del título
  // (>4 letras) para que "el serum" encuentre "Serum Pilar".
  const exact = rows.find((p) =>
    titulosDe(p).some((t) => hay.includes(t.toLowerCase())),
  );
  if (exact) return exact;
  return (
    rows.find((p) =>
      titulosDe(p)
        .join(' ')
        .toLowerCase()
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
  opts: { text?: string | null; preferTitles?: string[] },
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
    const product =
      pickProduct(rows, opts.text ?? '') ??
      preferred ??
      // Catálogo de un solo producto: es evidente de cuál se habla.
      (rows.length === 1 ? rows[0] : null);
    if (!product) return null;

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
        `- Lo que sabemos de él:\n${product.training_material.trim().slice(0, 1200)}`,
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
    };
  } catch {
    return null;
  }
}
