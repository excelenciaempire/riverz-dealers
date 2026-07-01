import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { csrfGuard } from '@/lib/csrf';
import { serverError } from '@/lib/api/errors';
import { slugifyTitle, handleSuffix, isUuid } from '@/lib/products/slug';
import { buildTrainingMaterial } from '@/lib/products/training-material';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';

/**
 * GET /api/products/[id]
 * Trae todo el producto + lista de agentes asignados.
 *
 * PATCH /api/products/[id]
 * Actualiza campos editables por el merchant:
 *   - custom_notes (texto libre)
 *   - custom_faqs (array de {q, a})
 *
 * Después de cualquier patch, recomputamos training_material — la
 * concatenación que el AI runner inyecta en el system prompt.
 */
export async function GET(
  _: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // El segmento de URL puede ser el id real (UUID) o el handle legible
  // (/productos/serum-pilar). Resolvemos por la columna que corresponda.
  const { data: product, error } = await supabase
    .from('shopify_products')
    .select('*')
    .eq(isUuid(id) ? 'id' : 'handle', id)
    .maybeSingle();
  if (error) {
    return serverError(error);
  }
  if (!product) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Trae los agentes asignados (product.id es el UUID real aunque la URL
  // venga por handle).
  const { data: assignments } = await supabase
    .from('ai_agent_products')
    .select('agent_id, ai_agents(id, name, persona, tone, is_active, model)')
    .eq('product_id', product.id);

  return NextResponse.json({
    product,
    agents: (assignments ?? [])
      .map((a: Record<string, unknown>) => a.ai_agents)
      .filter(Boolean),
  });
}

interface PatchBody {
  title?: string;
  description?: string | null;
  custom_notes?: string | null;
  custom_faqs?: Array<{ q: string; a: string }>;
  // Premium editor (migration 074): editable name, gallery, source URLs,
  // multi-offer pricing (reuses allowed_offers) + currency.
  images?: string[];
  websites?: string[];
  currency?: string | null;
  // Rich per-product context (migration 073) — injected into the agent prompt.
  say_guidelines?: string | null;
  never_say?: string[];
  escalation_triggers?: string[];
  allowed_offers?: Array<{
    label?: string;
    total?: number | string;
    conditions?: string;
    /** Número de unidades del paquete — el webhook de pedidos lo usa para
     *  detectar qué oferta eligió el cliente (flujos de recompra). */
    units?: number;
  }>;
  structured_research?: Record<string, unknown> | null;
  health_sensitive?: boolean;
}

/** Numeric price from an offer's `total` ("39.900", "$ 1,299", 39900…). */
function offerPrice(total: unknown): number | null {
  if (typeof total === 'number' && Number.isFinite(total)) return total;
  if (typeof total !== 'string') return null;
  // Strip everything but digits/.,- then normalise thousands/decimals.
  const cleaned = total.replace(/[^\d.,-]/g, '');
  if (!cleaned) return null;
  // If both separators exist, the last one is the decimal sep.
  let norm = cleaned;
  if (cleaned.includes(',') && cleaned.includes('.')) {
    norm = cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned.replace(/,/g, '');
  } else if (cleaned.includes(',')) {
    // Lone comma → treat as thousands unless it looks like decimals (,dd).
    norm = /,\d{1,2}$/.test(cleaned) ? cleaned.replace(',', '.') : cleaned.replace(/,/g, '');
  }
  const n = Number(norm);
  return Number.isFinite(n) ? n : null;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const block = await csrfGuard(request);
  if (block) return block;
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const locale = await getLocale();

  const body = (await request.json().catch(() => null)) as PatchBody | null;
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Validamos custom_faqs antes de tocar la DB.
  if (body.custom_faqs !== undefined) {
    if (!Array.isArray(body.custom_faqs)) {
      return NextResponse.json(
        { error: translate(locale, 'errProducts.customFaqsMustBeArray') },
        { status: 400 },
      );
    }
    for (const f of body.custom_faqs) {
      if (typeof f?.q !== 'string' || typeof f?.a !== 'string') {
        return NextResponse.json(
          { error: translate(locale, 'errProducts.customFaqInvalidShape') },
          { status: 400 },
        );
      }
    }
  }

  const patch: Record<string, unknown> = {};
  if (body.title !== undefined && body.title.trim()) patch.title = body.title.trim();
  if (body.description !== undefined) patch.description = body.description;
  if (body.custom_notes !== undefined) patch.custom_notes = body.custom_notes;
  if (body.custom_faqs !== undefined) patch.custom_faqs = body.custom_faqs;
  if (body.currency !== undefined) patch.currency = body.currency || null;

  // Gallery — keep only non-empty strings; mirror first into image_url so the
  // catalog/list thumbnail stays in sync.
  if (body.images !== undefined) {
    const imgs = (Array.isArray(body.images) ? body.images : [])
      .map((s) => (typeof s === 'string' ? s.trim() : ''))
      .filter(Boolean)
      .slice(0, 12);
    patch.images = imgs;
    patch.image_url = imgs[0] ?? null;
  }

  // Source URLs (max 5) — mirror first into url (existing scrape code path).
  if (body.websites !== undefined) {
    const sites = (Array.isArray(body.websites) ? body.websites : [])
      .map((s) => (typeof s === 'string' ? s.trim() : ''))
      .filter(Boolean)
      .slice(0, 5);
    patch.websites = sites;
    patch.url = sites[0] ?? null;
  }
  if (body.say_guidelines !== undefined) patch.say_guidelines = body.say_guidelines;
  if (body.never_say !== undefined)
    patch.never_say = Array.isArray(body.never_say) ? body.never_say : [];
  if (body.escalation_triggers !== undefined)
    patch.escalation_triggers = Array.isArray(body.escalation_triggers)
      ? body.escalation_triggers
      : [];
  if (body.allowed_offers !== undefined) {
    const offers = Array.isArray(body.allowed_offers) ? body.allowed_offers : [];
    patch.allowed_offers = offers;
    // The merchant edited the offers by hand → mark the row merchant-owned so
    // the auto-detector (scrape/backfill) never overwrites these values.
    patch.offers_auto_detected = false;
    // "Precios de venta" lives here now — derive price_min/max for the
    // catalog + runner from the offer totals.
    const prices = offers
      .map((o) => (o && typeof o === 'object' ? offerPrice(o.total) : null))
      .filter((n): n is number => n != null);
    if (prices.length > 0) {
      patch.price_min = Math.min(...prices);
      patch.price_max = Math.max(...prices);
    }
  }
  if (body.structured_research !== undefined)
    patch.structured_research = body.structured_research;
  if (body.health_sensitive !== undefined)
    patch.health_sensitive = !!body.health_sensitive;

  // Para evitar la race "patch + recompute training_material" en dos
  // updates separados (review adversarial), leemos el row actual y
  // armamos training_material desde {currentRow, ...patch} en una sola
  // operación. Sin ventana de read-modify-write.
  const { data: current, error: readErr } = await supabase
    .from('shopify_products')
    .select('*')
    .eq(isUuid(id) ? 'id' : 'handle', id)
    .maybeSingle();
  if (readErr) {
    return serverError(readErr);
  }
  if (!current) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // El handle es el segmento legible de la URL del editor. Para productos
  // MANUALES lo regeneramos cuando cambia el nombre (conservando el sufijo
  // estable) para que /productos/<handle> siga al nombre. Los de Shopify NO
  // se tocan: su handle es el slug real de la tienda y el routing de IA lo
  // usa para emparejar links que el cliente pega.
  if (
    patch.title &&
    current.shop_domain === 'manual' &&
    patch.title !== current.title
  ) {
    patch.handle = `${slugifyTitle(patch.title as string)}-${handleSuffix(
      current.external_id as number,
    )}`;
  }

  const merged = { ...current, ...patch };
  const training = buildTrainingMaterial(merged, locale);

  const { data: updated, error } = await supabase
    .from('shopify_products')
    .update({ ...patch, training_material: training })
    .eq('id', current.id)
    .select('*')
    .maybeSingle();
  if (error) {
    return serverError(error);
  }
  if (!updated) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, product: updated });
}
