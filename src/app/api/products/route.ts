import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { serverError } from '@/lib/api/errors';
import { escapeLike } from '@/lib/security/like';
import { csrfGuard } from '@/lib/csrf';

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

/**
 * POST /api/products
 * Create a product FROM SCRATCH (no Shopify needed). Stored in the same
 * shopify_products table so it flows into the catalog, the AI agent's
 * "Productos asignados" picker and product detail — identical to a synced
 * product, just with shop_domain='manual' and a generated external_id.
 */
export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const title = String(body?.title ?? '').trim();
  if (!title) {
    return NextResponse.json({ error: 'El nombre del producto es obligatorio.' }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id);
  if (!workspaceId) {
    return NextResponse.json({ error: 'No se pudo resolver el workspace.' }, { status: 400 });
  }

  const num = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const str = (v: unknown): string | null => {
    const s = String(v ?? '').trim();
    return s ? s : null;
  };

  const externalId = `manual_${randomUUID()}`;
  const handle =
    title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'producto';
  const priceMin = num(body?.price_min);
  const priceMax = num(body?.price_max) ?? priceMin;

  const { data, error } = await admin
    .from('shopify_products')
    .insert({
      user_id: user.id,
      workspace_id: workspaceId,
      shop_domain: 'manual',
      external_id: externalId,
      handle: `${handle}-${externalId.slice(-6)}`,
      title,
      description: str(body?.description),
      product_type: str(body?.product_type),
      price_min: priceMin,
      price_max: priceMax,
      currency: str(body?.currency) ?? 'COP',
      image_url: str(body?.image_url),
      custom_notes: str(body?.custom_notes),
      scrape_status: 'done',
      synced_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) return serverError(error);
  return NextResponse.json({ id: data.id });
}
