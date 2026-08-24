import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { serverError } from '@/lib/api/errors';
import { escapeLike } from '@/lib/security/like';
import { agruparPorPrincipal, type FilaAgrupable } from '@/lib/products/agrupar';

/**
 * El catálogo sincronizado de la cuenta, para elegir de qué puede hablar un
 * agente. Post-mig 057 va por workspace: cualquier miembro ve todo.
 *
 * Se devuelve AGRUPADO, igual que `/api/products`. Antes esta ruta ni siquiera
 * pedía `master_id`, así que el mismo serum aparecía cuatro veces —la fila de
 * la tienda y las tres publicaciones de Mercado Libre— mientras la pantalla de
 * Productos ya lo mostraba como uno. El comercio tenía que asignar cuatro cosas
 * para autorizar una, sin saber que eran la misma.
 *
 * `?search=` filtra por título.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const search = new URL(request.url).searchParams.get('search')?.trim();
  const admin = supabaseAdmin();
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id);
  if (!workspaceId) return NextResponse.json({ products: [] });
  let query = admin
    .from('shopify_products')
    .select(
      'id, title, handle, product_type, vendor, price_min, price_max, currency, image_url, url, master_id, platform',
    )
    .eq('workspace_id', workspaceId)
    .order('title', { ascending: true })
    .limit(500);
  if (search) {
    query = query.ilike('title', `%${escapeLike(search)}%`);
  }
  const { data, error } = await query;
  if (error) return serverError(error);
  return NextResponse.json({
    products: agruparPorPrincipal((data ?? []) as unknown as FilaAgrupable[]),
  });
}
