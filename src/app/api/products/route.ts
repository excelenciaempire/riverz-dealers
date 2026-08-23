import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { serverError } from '@/lib/api/errors';
import { escapeLike } from '@/lib/security/like';
import { csrfGuard } from '@/lib/csrf';
import { resolveWorkspaceCurrencyOrNull } from '@/lib/products/currency';
import { crearProducto, tituloDeProducto } from '@/lib/products/write';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';

/**
 * GET /api/products
 * Lista los productos sincronizados del workspace, con conteo de
 * agentes asignados por producto (para mostrar "Asignado a 2 agentes"
 * en la card de listado). Post-mig 057 la RLS de shopify_products
 * scope por workspace_member, así que no hace falta filtrar por
 * user_id en el query — todos los miembros del workspace ven todo.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const search = url.searchParams.get('q')?.trim() ?? '';
  const status = url.searchParams.get('status'); // scrape_status filter

  // La cuenta activa, no "todas las que este usuario puede ver".
  //
  // La consulta se apoyaba sólo en RLS, y RLS deja ver los productos de TODOS
  // los workspaces de los que uno es miembro: quien trabaja en dos cuentas veía
  // un catálogo mezclado —los productos de un comercio al lado de los de otro—
  // sin ninguna señal de cuál era cuál. Y la divisa se resolvía con
  // `workspaceIds[0]`, así que los precios de una cuenta se etiquetaban con la
  // moneda de la otra: una tienda argentina mostrando pesos colombianos.
  const activo = await resolveWorkspaceIdForUser(supabaseAdmin(), user.id);
  if (!activo) {
    return NextResponse.json({
      products: [],
      shopify_connected: false,
      store_platform: null,
      workspace_currency: null,
    });
  }

  let query = supabase
    .from('shopify_products')
    .select(
      `
      id,
      title,
      handle,
      description,
      product_type,
      vendor,
      tags,
      price_min,
      price_max,
      currency,
      image_url,
      url,
      shop_domain,
      is_bundle,
      bundle_app,
      scrape_status,
      scraped_at,
      ai_research_status,
      ai_research_generated_at,
      synced_at,
      master_id,
      platform,
      ai_agent_products(agent_id)
    `,
    )
    .eq('workspace_id', activo)
    .order('title', { ascending: true })
    .limit(500);

  if (search) {
    query = query.ilike('title', `%${escapeLike(search)}%`);
  }
  if (status === 'pending') {
    query = query.in('scrape_status', ['idle', 'queued']);
  } else if (status === 'done') {
    query = query.eq('scrape_status', 'done');
  } else if (status === 'failed') {
    query = query.eq('scrape_status', 'failed');
  } else if (status === 'bundle') {
    query = query.eq('is_bundle', true);
  }

  const { data, error } = await query;
  if (error) {
    return serverError(error);
  }

  const filas: Record<string, unknown>[] = (data ?? []).map((p: Record<string, unknown>) => {
    const apps = p.ai_agent_products as unknown[] | null;
    return {
      ...p,
      assigned_agent_count: Array.isArray(apps) ? apps.length : 0,
      ai_agent_products: undefined,
    };
  });

  // Un producto vendido en varios lados se lista UNA vez.
  //
  // El mismo producto tiene una fila por plataforma —cada una la sincroniza su
  // canal— y hasta acá la pantalla las mostraba todas: el comercio veía cuatro
  // tarjetas del mismo serum y no tenía forma de saber cuál editar. Ahora se
  // muestra la principal, que es la que manda el conocimiento, con sus
  // publicaciones colgando.
  //
  // Se pliega SÓLO si la principal está en la misma respuesta. Con un filtro
  // aplicado —buscar, o el estado del scrape— puede no estarlo, y esconder una
  // publicación detrás de una tarjeta que no se ve la haría desaparecer.
  const porId = new Map(filas.map((p) => [String(p.id), p]));
  const hijosDe = new Map<string, Record<string, unknown>[]>();
  for (const p of filas) {
    const master = p.master_id ? String(p.master_id) : '';
    if (!master || !porId.has(master)) continue;
    hijosDe.set(master, [...(hijosDe.get(master) ?? []), p]);
  }

  const products = filas
    .filter((p) => !(p.master_id && porId.has(String(p.master_id))))
    .map((p) => {
      const hijos = hijosDe.get(String(p.id)) ?? [];
      if (hijos.length === 0) return p;
      return {
        ...p,
        // Dónde más se vende, con el precio de cada lado. La tarjeta lo muestra
        // como una línea; el precio de cada canal es distinto y los dos son
        // ciertos, así que no se elige uno.
        listings: [p, ...hijos].map((x) => ({
          id: x.id,
          platform: x.platform ?? 'shopify',
          title: x.title,
          price_min: x.price_min,
          currency: x.currency,
          url: x.url,
          is_master: x.id === p.id,
        })),
      };
    });

  // El UI necesita saber si Shopify está conectado para mostrar el
  // empty state correcto / deshabilitar Sincronizar. Post-055 leemos
  // por workspace_id (a través del workspace member); el legacy
  // .eq('user_id', user.id) fallaba para miembros que no son quien
  // instaló.
  const admin = supabaseAdmin();
  // Cualquier plataforma de tienda, no sólo Shopify: desde la migración 126
  // un workspace puede tener Tiendanube o WooCommerce, y filtrar por
  // 'shopify' le decía a un comercio de Tiendanube que reconectara Shopify —
  // una tienda que nunca tuvo.
  const { data: shop } = await admin
    .from('shopify_connections')
    .select('id, shop_domain, status, platform')
    .eq('workspace_id', activo)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  const shopify_connected = !!shop;
  const store_platform = (shop as { platform?: string } | null)?.platform ?? null;

  // Divisa del workspace — para que el UI muestre precios de productos con
  // currency=null y prellene la divisa al crear/editar. Misma resolución que
  // usan los agentes.
  // Sin señal NO se inventa: una tienda argentina sin sincronizar mostraba
  // "39.990 COP" en cada producto, un precio que no existe en ningún lado.
  const workspace_currency = await resolveWorkspaceCurrencyOrNull(admin, activo);

  return NextResponse.json({
    products,
    shopify_connected,
    store_platform,
    workspace_currency,
  });
}

/**
 * POST /api/products
 * Crea un producto DESDE CERO (sin Shopify). El armado vive en
 * `@/lib/products/write`, que es el mismo código que usa el Operador.
 */
export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const locale = await getLocale();

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!tituloDeProducto(body ?? {})) {
    return NextResponse.json(
      { error: translate(locale, 'errProducts.productNameRequired') },
      { status: 400 },
    );
  }

  const admin = supabaseAdmin();
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id);
  if (!workspaceId) {
    return NextResponse.json(
      { error: translate(locale, 'errProducts.workspaceResolveFailed') },
      { status: 400 },
    );
  }

  const res = await crearProducto(admin, {
    userId: user.id,
    workspaceId,
    datos: body ?? {},
  });
  if (!res.ok) {
    if (res.motivo === 'falta_titulo') {
      return NextResponse.json(
        { error: translate(locale, 'errProducts.productNameRequired') },
        { status: 400 },
      );
    }
    return serverError(res.error);
  }
  return NextResponse.json({ id: res.id });
}
