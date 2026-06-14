import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { syncShopifyProducts } from '@/lib/shopify/product-sync';
import { decrypt } from '@/lib/channels/encryption';
import { detectBundleApp } from '@/lib/products/bundle-detection';

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
          'No hay una conexión Shopify activa. Conectá Shopify desde Integraciones primero.',
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

  // Corre el sync. Esta lib ya pagina, hace upsert, y GC-ea filas viejas.
  const result = await syncShopifyProducts(admin, {
    userId: user.id,
    shopDomain,
    accessToken,
  });

  // Detectamos bundles para todos los productos recién sincronizados.
  // Lo hacemos en una segunda pasada porque syncShopifyProducts es
  // genérica (vive en lib/shopify) y no debería conocer la lógica de
  // bundles. Leemos `raw` + `tags` del row recién insertado.
  const { data: rows } = await admin
    .from('shopify_products')
    .select('id, raw, tags')
    .eq('user_id', user.id);

  let bundlesDetected = 0;
  if (rows && rows.length > 0) {
    const updates: Array<{
      id: string;
      is_bundle: boolean;
      bundle_app: string | null;
      bundle_metadata: Record<string, unknown> | null;
    }> = [];
    for (const r of rows) {
      const detection = detectBundleApp(
        r.raw as Parameters<typeof detectBundleApp>[0],
        (r.tags as string[] | null) ?? [],
      );
      if (detection.isBundle) bundlesDetected++;
      updates.push({
        id: r.id as string,
        is_bundle: detection.isBundle,
        bundle_app: detection.app,
        bundle_metadata: detection.metadata,
      });
    }
    // Actualizamos en chunks para no exceder el payload de PostgREST.
    const CHUNK = 100;
    for (let i = 0; i < updates.length; i += CHUNK) {
      const slice = updates.slice(i, i + CHUNK);
      for (const u of slice) {
        await admin
          .from('shopify_products')
          .update({
            is_bundle: u.is_bundle,
            bundle_app: u.bundle_app,
            bundle_metadata: u.bundle_metadata,
          })
          .eq('id', u.id);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    synced: result.synced,
    deleted: result.deleted,
    bundles_detected: bundlesDetected,
  });
}
