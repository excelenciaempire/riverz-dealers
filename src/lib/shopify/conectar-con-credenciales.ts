import type { SupabaseClient } from '@supabase/supabase-js';
import { after } from 'next/server';
import { decrypt } from '@/lib/whatsapp/encryption';
import type { Locale } from '@/lib/i18n/config';
import { scrapeShopifyCatalogSources } from '@/lib/products/scrape-catalog-sources';
import { getLogger } from '@/lib/log/logger';
import { ShopifyAdminClient } from './admin-client';
import { getConnectionByShop, persistShopifyConnection } from './connection';
import {
  exchangeClientCredentialsForToken,
  ShopifyCredentialsError,
} from './oauth';
import { syncShopifyProducts } from './product-sync';

const log = getLogger('shopify.conectar-con-credenciales');

export type ResultadoConexion =
  | { ok: true; shopName: string | null }
  | {
      ok: false;
      /** `no_instalada`: la app no está instalada en esa tienda (todavía). */
      motivo: 'no_instalada' | 'credenciales' | 'guardar';
      error: string;
    };

/**
 * Conecta una tienda con el Client ID y el Client secret de una app de su
 * misma organización: el client credentials grant sólo funciona ahí, y sólo
 * con la app instalada. No lanza: devuelve el motivo y quien llama decide.
 */
export async function conectarConCredenciales(
  db: SupabaseClient,
  args: {
    userId: string;
    workspaceId: string;
    shop: string;
    clientId: string;
    clientSecret: string;
    callbackBase: string;
    locale?: Locale;
  }
): Promise<ResultadoConexion> {
  const { shop } = args;
  let token: Awaited<ReturnType<typeof exchangeClientCredentialsForToken>>;
  try {
    token = await exchangeClientCredentialsForToken({
      shop,
      clientId: args.clientId,
      clientSecret: args.clientSecret,
    });
  } catch (err) {
    return {
      ok: false,
      motivo:
        err instanceof ShopifyCredentialsError &&
        err.motivo === 'app_not_installed'
          ? 'no_instalada'
          : 'credenciales',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const client = new ShopifyAdminClient(shop, token.access_token);
  let shopName: string | null;
  try {
    shopName = (await client.getShopInfo()).name || null;
  } catch (err) {
    return {
      ok: false,
      motivo: 'credenciales',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  try {
    await persistShopifyConnection(db, {
      userId: args.userId,
      workspaceId: args.workspaceId,
      shopDomain: shop,
      shopName,
      accessToken: token.access_token,
      scope: token.scope || null,
      webhookSecret: args.clientSecret,
      clientId: args.clientId,
      connectionMethod: 'client_credentials',
      expiresIn: token.expires_in,
      refreshToken: null,
      refreshTokenExpiresIn: null,
    });
  } catch (err) {
    return {
      ok: false,
      motivo: 'guardar',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  try {
    await client.registerWebhooks(args.callbackBase);
  } catch (err) {
    log.error('webhook_register_failed', {
      shop,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  after(async () => {
    try {
      await syncShopifyProducts(db, {
        userId: args.userId,
        workspaceId: args.workspaceId,
        shopDomain: shop,
        accessToken: token.access_token,
      });
      await scrapeShopifyCatalogSources(db, {
        workspaceId: args.workspaceId,
        shopDomain: shop,
        locale: args.locale ?? 'es',
      });
    } catch (err) {
      log.error('initial_catalog_sync_or_scrape_failed', {
        shop,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return { ok: true, shopName };
}

/**
 * Conecta las tiendas que esperan a que se instale su app.
 *
 * La app que el comercio crea en su propia organización puede tener cualquier
 * URL, así que Shopify no nos avisa cuando la instalan. Se prueba de nuevo con
 * las credenciales guardadas: en cuanto está instalada, el grant funciona.
 * Con una app de la organización de Riverz el grant no aplica entre
 * organizaciones: esa se conecta por OAuth al instalarla.
 */
export async function conectarPendientes(
  db: SupabaseClient,
  opts: { workspaceId?: string; callbackBase: string }
): Promise<number> {
  let consulta = db
    .from('shopify_custom_apps')
    .select(
      'workspace_id, user_id, shop_domain, client_id, client_secret_encrypted'
    )
    .order('updated_at', { ascending: false })
    .limit(50);
  if (opts.workspaceId)
    consulta = consulta.eq('workspace_id', opts.workspaceId);
  const { data, error } = await consulta;
  if (error) throw new Error(`shopify_custom_apps: ${error.message}`);

  let conectadas = 0;
  for (const fila of data ?? []) {
    if (await getConnectionByShop(db, fila.shop_domain)) continue;
    let clientSecret: string;
    try {
      clientSecret = decrypt(fila.client_secret_encrypted);
    } catch {
      continue;
    }
    const r = await conectarConCredenciales(db, {
      userId: fila.user_id,
      workspaceId: fila.workspace_id,
      shop: fila.shop_domain,
      clientId: fila.client_id,
      clientSecret,
      callbackBase: opts.callbackBase,
    });
    if (r.ok) {
      conectadas += 1;
      log.info('pending_store_connected', {
        shop: fila.shop_domain,
        workspaceId: fila.workspace_id,
      });
    } else if (r.motivo !== 'no_instalada') {
      log.info('pending_store_not_connected', {
        shop: fila.shop_domain,
        motivo: r.motivo,
        error: r.error.slice(0, 200),
      });
    }
  }
  return conectadas;
}
