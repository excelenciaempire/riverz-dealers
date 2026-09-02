import { after, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { csrfGuard } from '@/lib/csrf';
import {
  exchangeClientCredentialsForToken,
  normalizeShopDomain,
} from '@/lib/shopify/oauth';
import { persistShopifyConnection } from '@/lib/shopify/connection';
import { ShopifyAdminClient } from '@/lib/shopify/admin-client';
import { syncShopifyProducts } from '@/lib/shopify/product-sync';
import { scrapeShopifyCatalogSources } from '@/lib/products/scrape-catalog-sources';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { getLogger } from '@/lib/log/logger';

const log = getLogger('shopify.connect-client-credentials');

/** Connect a store to a Shopify Dev Dashboard app using client credentials. */
export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;

  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { shop?: string; clientId?: string; clientSecret?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  const shop = normalizeShopDomain(body.shop ?? '');
  const clientId = (body.clientId ?? '').trim();
  const clientSecret = (body.clientSecret ?? '').trim();
  if (!shop) {
    return NextResponse.json(
      { error: translate(locale, 'errProducts.invalidShopDomain') },
      { status: 400 }
    );
  }
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: translate(locale, 'errProducts.shopifyMissingTokenFields') },
      { status: 400 }
    );
  }
  const workspaceId = await resolveWorkspaceIdForUser(supabase, user.id);
  if (!workspaceId) {
    return NextResponse.json(
      { error: translate(locale, 'errProducts.noWorkspaceForUser') },
      { status: 400 }
    );
  }

  let token: Awaited<ReturnType<typeof exchangeClientCredentialsForToken>>;
  try {
    token = await exchangeClientCredentialsForToken({
      shop,
      clientId,
      clientSecret,
    });
  } catch (err) {
    log.warn('credential_exchange_failed', {
      shop,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: translate(locale, 'errProducts.shopifyTokenInvalid') },
      { status: 400 }
    );
  }
  const client = new ShopifyAdminClient(shop, token.access_token);
  let shopName: string | null = null;
  try {
    shopName = (await client.getShopInfo()).name || null;
  } catch (err) {
    log.warn('token_validation_failed', {
      shop,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: translate(locale, 'errProducts.shopifyTokenInvalid') },
      { status: 400 }
    );
  }

  const admin = supabaseAdmin();
  try {
    await persistShopifyConnection(admin, {
      userId: user.id,
      workspaceId,
      shopDomain: shop,
      shopName,
      accessToken: token.access_token,
      scope: token.scope || null,
      webhookSecret: clientSecret,
      clientId,
      connectionMethod: 'client_credentials',
      expiresIn: token.expires_in,
      refreshToken: null,
      refreshTokenExpiresIn: null,
    });
  } catch (err) {
    log.error('persist_failed', {
      shop,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: translate(locale, 'errProducts.shopifyTokenInvalid') },
      { status: 500 }
    );
  }

  const callbackBase =
    process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
  try {
    await client.registerWebhooks(callbackBase);
  } catch (err) {
    log.error('webhook_register_failed', {
      shop,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  after(async () => {
    try {
      await syncShopifyProducts(admin, {
        userId: user.id,
        workspaceId,
        shopDomain: shop,
        accessToken: token.access_token,
      });
      await scrapeShopifyCatalogSources(admin, {
        workspaceId,
        shopDomain: shop,
        locale,
      });
    } catch (err) {
      log.error('initial_catalog_sync_or_scrape_failed', {
        shop,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  log.info('connect_client_credentials_success', {
    shop,
    userId: user.id,
    workspaceId,
  });
  return NextResponse.json({
    ok: true,
    shop_domain: shop,
    shop_name: shopName,
  });
}
