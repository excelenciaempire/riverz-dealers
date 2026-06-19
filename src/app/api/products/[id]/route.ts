import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { csrfGuard } from '@/lib/csrf';
import { serverError } from '@/lib/api/errors';

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

  const { data: product, error } = await supabase
    .from('shopify_products')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    return serverError(error);
  }
  if (!product) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Trae los agentes asignados.
  const { data: assignments } = await supabase
    .from('ai_agent_products')
    .select('agent_id, ai_agents(id, name, persona, tone, is_active, model)')
    .eq('product_id', id);

  return NextResponse.json({
    product,
    agents: (assignments ?? [])
      .map((a: Record<string, unknown>) => a.ai_agents)
      .filter(Boolean),
  });
}

interface PatchBody {
  custom_notes?: string | null;
  custom_faqs?: Array<{ q: string; a: string }>;
  // Rich per-product context (migration 073) — injected into the agent prompt.
  say_guidelines?: string | null;
  never_say?: string[];
  escalation_triggers?: string[];
  allowed_offers?: Array<{ label?: string; total?: number | string; conditions?: string }>;
  structured_research?: Record<string, unknown> | null;
  health_sensitive?: boolean;
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

  const body = (await request.json().catch(() => null)) as PatchBody | null;
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Validamos custom_faqs antes de tocar la DB.
  if (body.custom_faqs !== undefined) {
    if (!Array.isArray(body.custom_faqs)) {
      return NextResponse.json(
        { error: 'custom_faqs debe ser un array' },
        { status: 400 },
      );
    }
    for (const f of body.custom_faqs) {
      if (typeof f?.q !== 'string' || typeof f?.a !== 'string') {
        return NextResponse.json(
          { error: 'Cada FAQ debe tener q y a como string' },
          { status: 400 },
        );
      }
    }
  }

  const patch: Record<string, unknown> = {};
  if (body.custom_notes !== undefined) patch.custom_notes = body.custom_notes;
  if (body.custom_faqs !== undefined) patch.custom_faqs = body.custom_faqs;
  if (body.say_guidelines !== undefined) patch.say_guidelines = body.say_guidelines;
  if (body.never_say !== undefined)
    patch.never_say = Array.isArray(body.never_say) ? body.never_say : [];
  if (body.escalation_triggers !== undefined)
    patch.escalation_triggers = Array.isArray(body.escalation_triggers)
      ? body.escalation_triggers
      : [];
  if (body.allowed_offers !== undefined)
    patch.allowed_offers = Array.isArray(body.allowed_offers) ? body.allowed_offers : [];
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
    .eq('id', id)
    .maybeSingle();
  if (readErr) {
    return serverError(readErr);
  }
  if (!current) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const merged = { ...current, ...patch };
  const training = buildTrainingMaterial(merged);

  const { data: updated, error } = await supabase
    .from('shopify_products')
    .update({ ...patch, training_material: training })
    .eq('id', id)
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

/**
 * Concatenación ordenada del material que el AI usa para responder
 * sobre ESTE producto. El orden importa: lo más autoritario primero
 * (Shopify oficial → user override → AI research → scraped content),
 * porque algunos modelos privilegian el principio del contexto.
 */
function buildTrainingMaterial(p: Record<string, unknown>): string {
  const parts: string[] = [];

  const title = p.title as string | null;
  const description = p.description as string | null;
  const productType = p.product_type as string | null;
  const vendor = p.vendor as string | null;
  const tags = (p.tags as string[] | null) ?? [];
  const priceMin = p.price_min as number | null;
  const priceMax = p.price_max as number | null;
  const customNotes = p.custom_notes as string | null;
  const customFaqs = (p.custom_faqs as Array<{ q: string; a: string }> | null) ?? [];
  const aiResearch = p.ai_research as string | null;
  const aiFaqs = (p.ai_generated_faqs as Array<{ q: string; a: string }> | null) ?? [];
  const scraped = p.scraped_content as string | null;
  const bundleApp = p.bundle_app as string | null;

  if (title) parts.push(`# ${title}`);
  if (description) parts.push(`## Descripción\n${description}`);

  const meta: string[] = [];
  if (productType) meta.push(`Tipo: ${productType}`);
  if (vendor) meta.push(`Marca: ${vendor}`);
  if (tags.length > 0) meta.push(`Tags: ${tags.join(', ')}`);
  if (priceMin != null && priceMax != null) {
    meta.push(
      priceMin === priceMax
        ? `Precio: ${priceMin}`
        : `Precio: ${priceMin} – ${priceMax}`,
    );
  }
  if (meta.length > 0) parts.push(meta.join(' · '));

  if (bundleApp) parts.push(`Este producto forma parte de ofertas tipo "${bundleApp}".`);

  if (customNotes && customNotes.trim()) {
    parts.push(`## Notas del merchant\n${customNotes}`);
  }

  // FAQs (custom > AI). Deduplicamos por q normalizada.
  const seenQs = new Set<string>();
  const allFaqs: Array<{ q: string; a: string; source: 'custom' | 'ai' }> = [];
  for (const f of customFaqs) {
    const key = f.q.trim().toLowerCase();
    if (key && !seenQs.has(key)) {
      seenQs.add(key);
      allFaqs.push({ ...f, source: 'custom' });
    }
  }
  for (const f of aiFaqs) {
    const key = f.q.trim().toLowerCase();
    if (key && !seenQs.has(key)) {
      seenQs.add(key);
      allFaqs.push({ ...f, source: 'ai' });
    }
  }
  if (allFaqs.length > 0) {
    const faqLines = allFaqs
      .map((f) => `- **${f.q}**\n  ${f.a}`)
      .join('\n');
    parts.push(`## Preguntas frecuentes\n${faqLines}`);
  }

  if (aiResearch) parts.push(`## Investigación adicional\n${aiResearch}`);

  if (scraped) {
    parts.push(
      `## Contenido de la página del producto\n${scraped.slice(0, 8_000)}`,
    );
  }

  return parts.join('\n\n');
}
