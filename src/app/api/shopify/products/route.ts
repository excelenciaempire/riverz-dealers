import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';

/**
 * List the synced Shopify product catalog for the current user. Used
 * by the AI agent editor to pick which products an agent is allowed
 * to talk about.
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
  let query = admin
    .from('shopify_products')
    .select('id, title, handle, product_type, vendor, price_min, price_max, image_url')
    .eq('user_id', user.id)
    .order('title', { ascending: true })
    .limit(500);
  if (search) {
    query = query.ilike('title', `%${search}%`);
  }
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ products: data ?? [] });
}
