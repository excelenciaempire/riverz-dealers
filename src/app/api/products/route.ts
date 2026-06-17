import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { serverError } from '@/lib/api/errors';
import { escapeLike } from '@/lib/security/like';

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
  const { data: shop } = workspaceIds.length
    ? await admin
        .from('shopify_connections')
        .select('id, shop_domain, status')
        .in('workspace_id', workspaceIds)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle()
    : { data: null };

  const shopify_connected = !!shop;

  return NextResponse.json({
    products,
    shopify_connected,
  });
}
