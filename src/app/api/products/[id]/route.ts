import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { csrfGuard } from '@/lib/csrf';
import { serverError } from '@/lib/api/errors';
import { isUuid } from '@/lib/products/slug';
import { resolveWorkspaceCurrency } from '@/lib/products/currency';
import {
  actualizarProducto,
  borrarProducto,
  type CambiosDeProducto,
} from '@/lib/products/write';
import { leerFuentes } from '@/lib/products/scrape-sources';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';

/**
 * GET /api/products/[id]
 * Trae todo el producto + lista de agentes asignados.
 *
 * PATCH y DELETE son HTTP alrededor de `@/lib/products/write`: acá sólo queda
 * la sesión y la traducción del motivo de falla, porque el Operador escribe el
 * mismo catálogo sin pasar por estas rutas y las dos escrituras tienen que ser
 * literalmente el mismo código.
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

  // Divisa del workspace — el editor la usa para prellenar el selector
  // cuando el producto todavía no tiene divisa propia. Admin client porque
  // shopify_connections tiene RLS por user_id (un miembro que no instaló no
  // la vería con el cliente RLS).
  const workspaceId = (product as { workspace_id?: string | null }).workspace_id;
  const workspace_currency = workspaceId
    ? await resolveWorkspaceCurrency(supabaseAdmin(), workspaceId)
    : 'COP';

  // Dónde más se vende lo mismo (migración 183). Se resuelve desde la fila
  // PRINCIPAL —si esta cuelga de otra, las hermanas cuelgan de esa— para que
  // abrir cualquiera de las publicaciones muestre el grupo completo.
  const fila = product as { id: string; master_id?: string | null };
  const principalId = fila.master_id ?? fila.id;
  const { data: hermanas } = await supabase
    .from('shopify_products')
    .select('id, platform, title, price_min, currency, url, master_id')
    .or(`id.eq.${principalId},master_id.eq.${principalId}`);

  const listings = ((hermanas ?? []) as Array<Record<string, unknown>>).map((x) => ({
    id: x.id,
    platform: x.platform ?? 'shopify',
    title: x.title,
    price_min: x.price_min,
    currency: x.currency,
    url: x.url,
    is_master: x.id === principalId,
  }));

  return NextResponse.json({
    product: { ...product, listings: listings.length > 1 ? listings : [] },
    workspace_currency,
    agents: (assignments ?? [])
      .map((a: Record<string, unknown>) => a.ai_agents)
      .filter(Boolean),
  });
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

  const body = (await request.json().catch(() => null)) as CambiosDeProducto | null;
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const res = await actualizarProducto(supabase, {
    id,
    cambios: body,
    locale,
    // Sin workspaceId: este cliente es el del usuario y la RLS (mig 057) ya lo
    // recorta a los productos de su cuenta.
  });
  if (!res.ok) {
    if (res.motivo === 'faqs_no_es_lista') {
      return NextResponse.json(
        { error: translate(locale, 'errProducts.customFaqsMustBeArray') },
        { status: 400 },
      );
    }
    if (res.motivo === 'faq_mal_formada') {
      return NextResponse.json(
        { error: translate(locale, 'errProducts.customFaqInvalidShape') },
        { status: 400 },
      );
    }
    if (res.motivo === 'no_existe') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return serverError(res.error);
  }

  // Se agregó (o se cambió) una fuente: se lee sola, sin bloquear el guardado.
  //
  // La lectura tarda varios segundos por página y son hasta cinco. Hacer
  // esperar al comercio para guardar un nombre sería peor que el problema que
  // esto resuelve, así que el editor guarda ya y la lectura avanza detrás: el
  // estado queda en `scrape_status`, que la pantalla del producto ya consulta.
  if (res.fuentesCambiaron) {
    void leerFuentes(supabase, res.producto, locale).catch(() => {});
  }

  return NextResponse.json({
    ok: true,
    product: res.producto,
    releyendo: res.fuentesCambiaron,
  });
}

/**
 * DELETE /api/products/[id]
 * Borra el producto y todo lo que cuelga de él:
 *   - las asignaciones a asistentes (ai_agent_products, ON DELETE CASCADE)
 *   - su investigación / FAQs / contexto de venta (columnas del mismo row)
 *   - las imágenes que el merchant subió a Storage y que ningún otro
 *     producto del workspace esté usando
 * Es irreversible. Para un producto sincronizado, la siguiente
 * sincronización lo vuelve a traer si sigue en la tienda.
 */
export async function DELETE(
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

  // RLS (mig 057) ya gatea por miembro del workspace: si el producto no es
  // del workspace del usuario, no lo lee y no lo borra.
  const res = await borrarProducto(supabase, { id, admin: supabaseAdmin() });
  if (!res.ok) {
    if (res.motivo === 'no_existe') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return serverError(res.error);
  }

  return NextResponse.json({ ok: true, deleted_images: res.imagenesBorradas });
}
