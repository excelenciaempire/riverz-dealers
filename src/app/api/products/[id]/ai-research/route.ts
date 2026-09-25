import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { csrfGuard } from '@/lib/csrf';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { enrichProduct } from '@/lib/products/enrich';
import { aiBudgetGuard } from '@/lib/ai/rate-limit';

/**
 * POST /api/products/[id]/ai-research
 *
 * Genera FAQs + una breve nota de investigación sobre el producto usando
 * Anthropic (scrapea las URLs si hace falta y detecta ofertas de paso).
 * La lógica vive en `enrichProduct` (src/lib/products/enrich.ts), compartida
 * con el auto-enriquecimiento al conectar Shopify. Idempotente.
 */
export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const block = await csrfGuard(req);
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

  // Lo pide una persona: si la cuenta no puede usar la IA, que la pantalla lo
  // diga. La sesión sólo ve productos de sus cuentas.
  const { data: producto } = await supabase
    .from('shopify_products')
    .select('workspace_id')
    .eq('id', id)
    .maybeSingle();
  if (!producto) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const over = await aiBudgetGuard((producto as { workspace_id: string }).workspace_id);
  if (over) return over;

  const body = (await req.json().catch(() => null)) as {
    refresh_sources?: unknown;
  } | null;
  const result = await enrichProduct(supabase, id, locale, {
    // El botón del editor manda esta señal para incluir cualquier pre-landing
    // o cambio de URL guardado justo antes de investigar. Las ejecuciones
    // automáticas mantienen la lectura existente para no gastar cuota de más.
    refreshSources: body?.refresh_sources === true,
  });
  if (result.ok) {
    return NextResponse.json({ ok: true, faqs_count: result.faqsCount });
  }
  if (result.reason === 'not_found') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (result.reason === 'no_api_key') {
    return NextResponse.json(
      { error: translate(locale, 'errProducts.anthropicKeyMissing') },
      { status: 500 }
    );
  }
  // Model/provider failure — detail already persisted to ai_research_error.
  return NextResponse.json(
    { error: translate(locale, 'errProducts.researchFailed') },
    { status: 502 }
  );
}
