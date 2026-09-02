import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { syncShopifyProducts } from '@/lib/shopify/product-sync';
import { decrypt } from '@/lib/whatsapp/encryption';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import {
  getConnectionForUser,
  getConnectionForWorkspace,
} from '@/lib/shopify/connection';
import { scrapeShopifyCatalogSources } from '@/lib/products/scrape-catalog-sources';
import { getLogger } from '@/lib/log/logger';

const log = getLogger('products.sync');

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
export async function POST(req: Request) {
  const block = await csrfGuard(req);
  if (block) return block;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const locale = await getLocale();

  const admin = supabaseAdmin();

  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id);
  const connection = workspaceId
    ? await getConnectionForWorkspace(admin, workspaceId)
    : await getConnectionForUser(admin, user.id);
  if (!connection) {
    return NextResponse.json(
      { error: translate(locale, 'errProducts.noShopifyStoreConnected') },
      { status: 400 }
    );
  }

  const { data: row } = await admin
    .from('shopify_connections')
    .select('access_token, workspace_id')
    .eq('platform', 'shopify')
    .eq('id', connection.id)
    .maybeSingle();
  if (!row) {
    return NextResponse.json(
      { error: translate(locale, 'errProducts.shopifyConnectionNotFound') },
      { status: 404 }
    );
  }

  try {
    const connectionWorkspaceId = (row as { workspace_id: string })
      .workspace_id;
    const result = await syncShopifyProducts(admin, {
      userId: connection.user_id,
      workspaceId: connectionWorkspaceId,
      shopDomain: connection.shop_domain,
      accessToken: decrypt((row as { access_token: string }).access_token),
    });

    after(async () => {
      try {
        await scrapeShopifyCatalogSources(admin, {
          workspaceId: connectionWorkspaceId,
          shopDomain: connection.shop_domain,
          locale,
        });
      } catch (error) {
        log.error('catalog_scrape_failed', {
          shop: connection.shop_domain,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    return NextResponse.json({
      ok: true,
      synced: result.synced,
      deleted: result.deleted,
      bundles_detected: result.bundlesDetected,
      prelandings_found: result.prelandingsFound,
      scrape_queued: true,
    });
  } catch (error) {
    log.error('catalog_sync_failed', {
      shop: connection.shop_domain,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: translate(locale, 'errProducts.shopifySyncFailed') },
      { status: 502 }
    );
  }
}
