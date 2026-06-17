import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { serverError } from '@/lib/api/errors';

/**
 * List the synced Shopify product catalog for the current workspace.
 * Used by the AI agent editor to pick which products an agent is
 * allowed to talk about. Post-mig 057 the catalog is workspace-scoped
 * directly — any workspace member sees the full catalog.
 *
 * Optional ?search= filters by title (case-insensitive substring).
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
    .select('id, title, handle, product_type, vendor, price_min, price_max, image_url')
    .eq('workspace_id', workspaceId)
    .order('title', { ascending: true })
    .limit(500);
  if (search) {
    query = query.ilike('title', `%${search}%`);
  }
  const { data, error } = await query;
  if (error) return serverError(error);
  return NextResponse.json({ products: data ?? [] });
}
