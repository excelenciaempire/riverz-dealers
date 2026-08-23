import { randomBytes } from 'crypto'
import { enrichProducts } from '@/lib/products/enrich'
import { unificarLoObvio } from '@/lib/products/unify'
import type { SupabaseClient } from '@supabase/supabase-js'
import { persistStoreConnection } from './connection'
import { upsertCatalog } from './catalog'
import {
  TiendanubeClient,
  normalizeTiendanubeProduct,
  pickLocalized,
  tiendanubeStoreDomain,
} from './providers/tiendanube'
import { WooCommerceClient, normalizeWooProduct } from './providers/woocommerce'
import type { NormalizedProduct, StoreCredentials } from './types'

/**
 * Todo lo que pasa DESPUÉS de obtener credenciales válidas: leer los
 * datos de la tienda, guardar la conexión, registrar webhooks y traer el
 * catálogo. Es idéntico para las dos plataformas nuevas salvo el cliente,
 * y vive acá para que el flujo OAuth, el de claves manuales y el resync
 * hagan exactamente lo mismo.
 *
 * El catálogo se sincroniza en el momento de conectar a propósito: sin
 * productos el agente no puede vender nada y el comercio ve una tienda
 * "conectada" que no sirve para nada.
 */

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || 'https://riverz.co'
}

export interface SetupResult {
  connectionId: string
  shopDomain: string
  shopName: string | null
  productsSynced: number
}

// ── Tiendanube ───────────────────────────────────────────────────────

export async function completeTiendanubeConnection(
  db: SupabaseClient,
  args: {
    userId: string
    workspaceId: string
    storeId: string
    accessToken: string
    scope: string
  },
): Promise<SetupResult> {
  // El dominio no lo da el intercambio del token: hay que preguntarlo.
  // Sin él no podemos armar los links de producto ni identificar la
  // tienda en la UI, así que esto sí puede fallar la conexión entera.
  const bootstrap = new TiendanubeClient(args.storeId, args.accessToken, args.storeId)
  const store = await bootstrap.getStore()

  const shopDomain =
    tiendanubeStoreDomain(store) || `${args.storeId}.mitiendanube.com`
  const mainLanguage = store.main_language
  const shopName = pickLocalized(store.name, mainLanguage) || shopDomain
  const currency = store.main_currency || null

  const { id } = await persistStoreConnection(db, {
    platform: 'tiendanube',
    userId: args.userId,
    workspaceId: args.workspaceId,
    shopDomain,
    shopName,
    externalStoreId: args.storeId,
    storeUrl: `https://${shopDomain}`,
    accessToken: args.accessToken,
    currency,
    scope: args.scope,
    connectionMethod: 'oauth',
  })

  const client = new TiendanubeClient(args.storeId, args.accessToken, shopDomain)
  // Los webhooks y el catálogo no deben tumbar una conexión que YA quedó
  // guardada: el comercio puede reintentar el sync desde Ajustes, pero
  // perder la credencial recién obtenida lo obliga a rehacer todo el OAuth.
  await client.registerWebhooks(siteUrl()).catch((err) => {
    console.error('[tiendanube] registro de webhooks falló:', err)
  })

  let productsSynced = 0
  try {
    productsSynced = (
      await syncTiendanubeCatalog(db, {
        userId: args.userId,
        workspaceId: args.workspaceId,
        shopDomain,
        storeId: args.storeId,
        accessToken: args.accessToken,
        mainLanguage,
        currency,
      })
    ).synced
  } catch (err) {
    console.error('[tiendanube] sync inicial de catálogo falló:', err)
  }

  return { connectionId: id, shopDomain, shopName, productsSynced }
}

export async function syncTiendanubeCatalog(
  db: SupabaseClient,
  args: {
    userId: string
    workspaceId: string
    shopDomain: string
    storeId: string
    accessToken: string
    mainLanguage?: string
    currency: string | null
  },
): Promise<{ synced: number; deleted: number }> {
  const client = new TiendanubeClient(args.storeId, args.accessToken, args.shopDomain)
  // Solo productos publicados: el catálogo alimenta al agente, y ofrecer
  // algo despublicado termina en un link roto para el cliente.
  const raw = await client.paginate<unknown>('/products?published=true')
  const products = raw
    .map((p) =>
      normalizeTiendanubeProduct(p, {
        storeDomain: args.shopDomain,
        mainLanguage: args.mainLanguage,
      }),
    )
    .filter((p): p is NormalizedProduct => p != null)

  return upsertCatalog(db, {
    platform: 'tiendanube',
    userId: args.userId,
    workspaceId: args.workspaceId,
    shopDomain: args.shopDomain,
    currency: args.currency,
    products,
  })
}

// ── WooCommerce ──────────────────────────────────────────────────────

export async function completeWooConnection(
  db: SupabaseClient,
  args: {
    userId: string
    workspaceId: string
    siteUrl: string
    consumerKey: string
    consumerSecret: string
    keyId?: number | null
    /**
     * El catálogo de una tienda grande tarda. Cuando esto corre dentro
     * del callback servidor-a-servidor de /wc-auth conviene apagarlo: ese
     * POST lo hace el WordPress del comercio y si tarda demasiado corta y
     * le muestra un error aunque la conexión haya quedado bien. En ese
     * caso el sync lo dispara la vuelta al navegador.
     */
    syncCatalog?: boolean
  },
): Promise<SetupResult> {
  const client = new WooCommerceClient(
    args.siteUrl,
    args.consumerKey,
    args.consumerSecret,
  )

  // Validamos la credencial antes de guardarla: un par de claves con
  // permisos insuficientes o un sitio sin la REST API expuesta debe
  // fallar acá, no callado tres días después cuando no llega un pedido.
  await client.get('/products', { per_page: 1 })

  const info = await client.getStoreInfo()

  // El secreto con el que WooCommerce firmará sus entregas. Lo elegimos
  // nosotros (a diferencia de Shopify) y es por tienda.
  const webhookSecret = randomBytes(32).toString('hex')

  const { id } = await persistStoreConnection(db, {
    platform: 'woocommerce',
    userId: args.userId,
    workspaceId: args.workspaceId,
    shopDomain: args.siteUrl,
    shopName: info.name,
    externalStoreId: args.keyId != null ? String(args.keyId) : null,
    storeUrl: `https://${args.siteUrl}`,
    accessToken: args.consumerKey,
    apiSecret: args.consumerSecret,
    webhookSecret,
    currency: info.currency || null,
    scope: 'read_write',
    connectionMethod: 'api_key',
  })

  await client.registerWebhooks(siteUrl(), webhookSecret).catch((err) => {
    console.error('[woocommerce] registro de webhooks falló:', err)
  })

  let productsSynced = 0
  if (args.syncCatalog !== false) {
    try {
      productsSynced = (
        await syncWooCatalog(db, {
          userId: args.userId,
          workspaceId: args.workspaceId,
          siteUrl: args.siteUrl,
          consumerKey: args.consumerKey,
          consumerSecret: args.consumerSecret,
          currency: info.currency || null,
        })
      ).synced
    } catch (err) {
      console.error('[woocommerce] sync inicial de catálogo falló:', err)
    }
  }

  return {
    connectionId: id,
    shopDomain: args.siteUrl,
    shopName: info.name,
    productsSynced,
  }
}

export async function syncWooCatalog(
  db: SupabaseClient,
  args: {
    userId: string
    workspaceId: string
    siteUrl: string
    consumerKey: string
    consumerSecret: string
    currency: string | null
  },
): Promise<{ synced: number; deleted: number }> {
  const client = new WooCommerceClient(
    args.siteUrl,
    args.consumerKey,
    args.consumerSecret,
  )
  const raw = await client.paginate<unknown>('/products', {
    query: { status: 'publish' },
  })
  const products = raw
    .map(normalizeWooProduct)
    .filter((p): p is NormalizedProduct => p != null)

  return upsertCatalog(db, {
    platform: 'woocommerce',
    userId: args.userId,
    workspaceId: args.workspaceId,
    shopDomain: args.siteUrl,
    currency: args.currency,
    products,
  })
}

// ── Resync desde credenciales ya guardadas ───────────────────────────

/** Vuelve a traer el catálogo de una tienda ya conectada. */
export async function resyncCatalog(
  db: SupabaseClient,
  store: StoreCredentials,
): Promise<{ synced: number; deleted: number }> {
  const resultado = await sincronizar(db, store)
  // Y se enriquece: leer la página de cada producto y sacarle lo que la API de
  // la tienda no devuelve —ingredientes, medidas, modo de uso, garantía—, que
  // es justo lo que la gente pregunta.
  //
  // Corría sólo para Shopify. Un comercio de Tiendanube o WooCommerce tenía el
  // catálogo sincronizado y el conocimiento vacío: su agente sabía el título y
  // el precio, y nada más. No se espera el resultado — son varias páginas por
  // producto y el catálogo ya está listo para usarse sin esto.
  void enrichProducts(db, {
    workspaceId: store.workspaceId,
    max: 25,
    locale: 'es',
  }).catch(() => {})
  // Y se unifica lo que no admite duda: el mismo producto en dos plataformas
  // con el mismo SKU es el mismo producto. Sin esto, quien vende en Shopify y
  // en Mercado Libre carga el conocimiento dos veces —o, lo que pasa siempre,
  // lo carga una y el agente contesta vacío por el otro canal.
  void unificarLoObvio(db, store.workspaceId).catch(() => {})
  return resultado
}

async function sincronizar(
  db: SupabaseClient,
  store: StoreCredentials,
): Promise<{ synced: number; deleted: number }> {
  if (store.platform === 'tiendanube') {
    if (!store.externalStoreId) {
      throw new Error('Conexión de Tiendanube sin id de tienda')
    }
    return syncTiendanubeCatalog(db, {
      userId: store.userId,
      workspaceId: store.workspaceId,
      shopDomain: store.shopDomain,
      storeId: store.externalStoreId,
      accessToken: store.accessToken,
      currency: store.currency,
    })
  }
  if (store.platform === 'woocommerce') {
    if (!store.apiSecret) {
      throw new Error('Conexión de WooCommerce sin consumer_secret')
    }
    return syncWooCatalog(db, {
      userId: store.userId,
      workspaceId: store.workspaceId,
      siteUrl: store.shopDomain,
      consumerKey: store.accessToken,
      consumerSecret: store.apiSecret,
      currency: store.currency,
    })
  }
  throw new Error(`resyncCatalog no soporta ${store.platform}`)
}
