import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { syncShopifyProducts } from '@/lib/shopify/product-sync';
import { decrypt } from '@/lib/channels/encryption';

/**
 * POST /api/products/sync
 *
 * Tira del catálogo Shopify, upserta en shopify_products, detecta
 * bundles, y devuelve un resumen. Idempotente — corre múltiples veces
 * sin duplicar nada (lib/shopify/product-sync.ts hace upsert por
 * (shop_domain, external_id)).
 *
 * Auth: usuario autenticado del workspace + conexión Shopify activa.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = supabaseAdmin();

  // Buscamos la conexión Shopify activa del usuario.
  const { data: connection, error: connErr } = await admin
    .from('channel_connections')
    .select('*')
    .eq('user_id', user.id)
    .eq('channel', 'shopify')
    .eq('status', 'connected')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (connErr) {
    return NextResponse.json({ error: connErr.message }, { status: 500 });
  }
  if (!connection) {
    return NextResponse.json(
      {
        error:
          'No hay una conexión Shopify activa. Conecta Shopify desde Integraciones primero.',
      },
      { status: 412 },
    );
  }

  const secrets = (connection.secrets ?? {}) as Record<string, unknown>;
  const config = (connection.config ?? {}) as Record<string, unknown>;
  const shopDomain = String(config.shop_domain ?? '');
  const encryptedToken = String(secrets.access_token ?? '');
  if (!shopDomain || !encryptedToken) {
    return NextResponse.json(
      { error: 'La conexión Shopify no tiene shop_domain o access_token' },
      { status: 500 },
    );
  }

  const accessToken = decrypt(encryptedToken);

  // Corre el sync. lib/shopify/product-sync.ts ahora detecta bundles
  // inline en productToRow() y los persiste en el mismo upsert chunked
  // — sin N+1. Devuelve {synced, deleted, bundlesDetected}.
  const result = await syncShopifyProducts(admin, {
    userId: user.id,
    shopDomain,
    accessToken,
  });

  return NextResponse.json({
    ok: true,
    synced: result.synced,
    deleted: result.deleted,
    bundles_detected: result.bundlesDetected,
  });
}
