import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { serverError } from '@/lib/api/errors';
import { escapeLike } from '@/lib/security/like';
import { csrfGuard } from '@/lib/csrf';
import { resolveWorkspaceCurrency } from '@/lib/products/currency';
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
      ai_agent_products(agent_id)
    `,
    )
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

  const products = (data ?? []).map((p: Record<string, unknown>) => {
    const apps = p.ai_agent_products as unknown[] | null;
    return {
      ...p,
      assigned_agent_count: Array.isArray(apps) ? apps.length : 0,
      ai_agent_products: undefined,
    };
  });

  // El UI necesita saber si Shopify está conectado para mostrar el
  // empty state correcto / deshabilitar Sincronizar. Post-055 leemos
  // por workspace_id (a través del workspace member); el legacy
  // .eq('user_id', user.id) fallaba para miembros que no son quien
  // instaló.
  const admin = supabaseAdmin();
  const { data: memberships } = await admin
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', user.id);
  const workspaceIds = ((memberships ?? []) as { workspace_id: string }[]).map(
    (m) => m.workspace_id,
  );
  // Cualquier plataforma de tienda, no sólo Shopify: desde la migración 126
  // un workspace puede tener Tiendanube o WooCommerce, y filtrar por
  // 'shopify' le decía a un comercio de Tiendanube que reconectara Shopify —
  // una tienda que nunca tuvo.
  const { data: shop } = workspaceIds.length
    ? await admin
        .from('shopify_connections')
        .select('id, shop_domain, status, platform')
        .in('workspace_id', workspaceIds)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle()
    : { data: null };

  const shopify_connected = !!shop;
  const store_platform = (shop as { platform?: string } | null)?.platform ?? null;

  // Divisa del workspace — para que el UI muestre precios de productos con
  // currency=null y prellene la divisa al crear/editar. Misma resolución que
  // usan los agentes.
  const workspace_currency = workspaceIds.length
    ? await resolveWorkspaceCurrency(admin, workspaceIds[0])
    : 'COP';

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
