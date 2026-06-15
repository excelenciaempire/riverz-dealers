import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { getConnectionForUser } from '@/lib/shopify/connection';
import { decrypt } from '@/lib/whatsapp/encryption';
import { syncShopifyProducts } from '@/lib/shopify/product-sync';

/**
 * Manually re-pull the product catalog from Shopify. The first sync
 * runs at OAuth-callback time; this endpoint lets users refresh when
 * they add or rename products without disconnecting/reconnecting.
 */
export async function POST(req: Request) {
  const block = await csrfGuard(req);
  if (block) return block;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = supabaseAdmin();
  const conn = await getConnectionForUser(admin, user.id);
  if (!conn) {
    return NextResponse.json(
      { error: 'No hay tienda Shopify conectada.' },
      { status: 400 },
    );
  }

  // Look up the encrypted token directly — getConnectionForUser strips it.
  const { data: row } = await admin
    .from('shopify_connections')
    .select('access_token')
    .eq('id', conn.id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: 'connection not found' }, { status: 404 });

  try {
    const result = await syncShopifyProducts(admin, {
      userId: user.id,
      shopDomain: conn.shop_domain,
      accessToken: decrypt((row as { access_token: string }).access_token),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'sync failed' },
      { status: 502 },
    );
  }
}
