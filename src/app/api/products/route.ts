import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';

/**
 * GET /api/products
 * Lista los productos sincronizados del workspace, con conteo de
 * agentes asignados por producto (para mostrar "Asignado a 2 agentes"
 * en la card de listado).
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
    .eq('user_id', user.id)
    .order('title', { ascending: true })
    .limit(500);

  if (search) {
    query = query.ilike('title', `%${search}%`);
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
    return NextResponse.json({ error: error.message }, { status: 500 });
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
  // empty state correcto / deshabilitar Sincronizar. Lookup barato
  // contra channel_connections con admin client (la tabla está
  // workspace-scoped en RLS pero acá filtramos por user_id directo).
  const admin = supabaseAdmin();
  const { data: shop } = await admin
    .from('channel_connections')
    .select('id, status')
    .eq('user_id', user.id)
    .eq('channel', 'shopify')
    .eq('status', 'connected')
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    products,
    shopify_connected: !!shop,
  });
}
