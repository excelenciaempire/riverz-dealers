import { after, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import {
  getConnectionForUser,
  getConnectionForWorkspace,
} from '@/lib/shopify/connection';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { decrypt } from '@/lib/whatsapp/encryption';
import { syncShopifyProducts } from '@/lib/shopify/product-sync';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { scrapeShopifyCatalogSources } from '@/lib/products/scrape-catalog-sources';
import { getLogger } from '@/lib/log/logger';

const log = getLogger('shopify.products.sync');

/**
 * Manually re-pull the product catalog from Shopify. The first sync
 * runs at OAuth-callback time; this endpoint lets users refresh when
 * they add or rename products without disconnecting/reconnecting.
 *
 * Connection lookup is workspace-scoped (migration 055), and the
 * downstream `syncShopifyProducts` writes workspace_id directly on
 * each shopify_products row (migration 057). user_id is preserved
 * for legacy compatibility but no longer drives scoping.
 */
export async function POST(req: Request) {
  const block = await csrfGuard(req);
  if (block) return block;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const locale = await getLocale();

  const admin = supabaseAdmin();
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id);
  const conn = workspaceId
    ? await getConnectionForWorkspace(admin, workspaceId)
    : await getConnectionForUser(admin, user.id);
  if (!conn) {
    return NextResponse.json(
      { error: translate(locale, 'errProducts.noShopifyStoreConnected') },
      { status: 400 }
    );
  }

  // Look up the encrypted token + workspace_id directly — getConnectionFor*
  // strips both. workspace_id is needed for the product upsert (mig 057).
  const { data: row } = await admin
    .from('shopify_connections')
    .select('access_token, workspace_id')
    .eq('platform', 'shopify')
    .eq('id', conn.id)
    .maybeSingle();
  if (!row)
    return NextResponse.json(
      { error: translate(locale, 'errProducts.shopifyConnectionNotFound') },
      { status: 404 }
    );

  try {
    const result = await syncShopifyProducts(admin, {
      userId: conn.user_id,
      workspaceId: (row as { workspace_id: string }).workspace_id,
      shopDomain: conn.shop_domain,
      accessToken: decrypt((row as { access_token: string }).access_token),
    });
    const connectionWorkspaceId = (row as { workspace_id: string })
      .workspace_id;
    after(async () => {
      try {
        await scrapeShopifyCatalogSources(admin, {
          workspaceId: connectionWorkspaceId,
          shopDomain: conn.shop_domain,
          locale,
        });
      } catch (error) {
        log.error('catalog_scrape_failed', {
          shop: conn.shop_domain,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    return NextResponse.json({ ok: true, ...result, scrape_queued: true });
  } catch (err) {
    log.error('catalog_sync_failed', {
      shop: conn.shop_domain,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: translate(locale, 'errProducts.shopifySyncFailed') },
      { status: 502 }
    );
  }
}
