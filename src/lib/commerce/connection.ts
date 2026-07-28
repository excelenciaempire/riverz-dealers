import type { SupabaseClient } from '@supabase/supabase-js'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import type {
  CommercePlatform,
  ConnectionMethod,
  ConnectionStatus,
  StoreCredentials,
} from './types'

/**
 * Persistencia de conexiones de tienda, genérica por plataforma.
 *
 * Vive sobre `shopify_connections` (migración 126 la volvió
 * multi-plataforma con la columna `platform`). El nombre de la tabla
 * quedó por compatibilidad: renombrarla obligaría a reescribir los ~60
 * consumidores existentes sin ganar nada funcional.
 *
 * INVARIANTE: toda lectura filtra por `platform`. Un workspace puede
 * tener Shopify y WooCommerce conectados a la vez, y cada camino de
 * código debe encontrar LA SUYA — tomar "la conexión más reciente del
 * workspace" le entregaría a la Admin API de Shopify un consumer_key de
 * WooCommerce.
 */

const SELECT_COLUMNS =
  'id, platform, workspace_id, user_id, shop_domain, shop_name, external_store_id, ' +
  'store_url, access_token, api_secret, currency, scope, status, connection_method'

interface ConnectionRow {
  id: string
  platform: CommercePlatform | null
  workspace_id: string
  user_id: string
  shop_domain: string
  shop_name: string | null
  external_store_id: string | null
  store_url: string | null
  access_token: string
  api_secret: string | null
  currency: string | null
  scope: string | null
  status: ConnectionStatus
  connection_method: ConnectionMethod | null
}

/**
 * Descifra la fila. Devuelve null si el token no se puede descifrar
 * (rotación de ENCRYPTION_KEY, escritura corrupta): preferimos tratar la
 * conexión como inexistente antes que reventar el webhook con una
 * excepción de crypto que el llamador no puede manejar.
 */
function toCredentials(row: ConnectionRow): StoreCredentials | null {
  let accessToken: string
  try {
    accessToken = decrypt(row.access_token)
  } catch {
    console.error(
      '[commerce] token indescifrable para',
      row.platform,
      row.shop_domain,
    )
    return null
  }
  let apiSecret: string | null = null
  if (row.api_secret) {
    try {
      apiSecret = decrypt(row.api_secret)
    } catch {
      // El secreto secundario roto NO invalida la conexión entera: en
      // WooCommerce sí hace falta para autenticar (y la request fallará
      // con 401, que ya marcamos como expirada), pero en el resto es
      // opcional y perder la conexión sería peor.
      console.error('[commerce] api_secret indescifrable para', row.shop_domain)
    }
  }
  return {
    id: row.id,
    platform: (row.platform ?? 'shopify') as CommercePlatform,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    shopDomain: row.shop_domain,
    shopName: row.shop_name,
    externalStoreId: row.external_store_id,
    storeUrl: row.store_url,
    accessToken,
    apiSecret,
    currency: row.currency,
    scope: row.scope,
    status: row.status,
    connectionMethod: (row.connection_method ?? 'oauth') as ConnectionMethod,
  }
}

/**
 * Crea o actualiza la conexión de una tienda.
 *
 * El upsert va por (user_id, shop_domain) —la única constraint que
 * existe en la tabla desde la 021— así que reconectar la misma tienda
 * con el mismo usuario refresca la fila en lugar de duplicarla. Las
 * columnas ausentes del payload conservan su valor previo (PostgREST
 * hace merge), de ahí que solo mandemos lo que realmente cambia.
 */
export async function persistStoreConnection(
  db: SupabaseClient,
  args: {
    platform: CommercePlatform
    userId: string
    workspaceId: string
    shopDomain: string
    shopName?: string | null
    externalStoreId?: string | null
    storeUrl?: string | null
    accessToken: string
    apiSecret?: string | null
    webhookSecret?: string | null
    currency?: string | null
    scope?: string | null
    connectionMethod: ConnectionMethod
  },
): Promise<{ id: string }> {
  const row: Record<string, unknown> = {
    platform: args.platform,
    user_id: args.userId,
    workspace_id: args.workspaceId,
    shop_domain: args.shopDomain,
    shop_name: args.shopName ?? null,
    access_token: encrypt(args.accessToken),
    scope: args.scope ?? null,
    status: 'active',
    last_error: null,
    connection_method: args.connectionMethod,
    installed_at: new Date().toISOString(),
    uninstalled_at: null,
  }
  if (args.externalStoreId != null) row.external_store_id = args.externalStoreId
  if (args.storeUrl != null) row.store_url = args.storeUrl
  if (args.currency != null) row.currency = args.currency
  if (args.apiSecret != null) row.api_secret = encrypt(args.apiSecret)
  if (args.webhookSecret != null) row.webhook_secret = encrypt(args.webhookSecret)

  const { data, error } = await db
    .from('shopify_connections')
    .upsert(row, { onConflict: 'user_id,shop_domain' })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(
      `No se pudo guardar la conexión de ${args.platform}: ${error?.message}`,
    )
  }
  return { id: data.id as string }
}

/**
 * La conexión activa de una tienda concreta (camino de webhooks).
 *
 * Ordena por `installed_at DESC` porque una reinstalación con otro
 * usuario de la misma cuenta (socio, transferencia, asiento de soporte)
 * inserta una SEGUNDA fila activa —la constraint es (user_id,
 * shop_domain)— y `.maybeSingle()` sin el limit reventaría todos los
 * webhooks de esa tienda.
 */
export async function getStoreByDomain(
  db: SupabaseClient,
  platform: CommercePlatform,
  shopDomain: string,
): Promise<StoreCredentials | null> {
  const { data } = await db
    .from('shopify_connections')
    .select(SELECT_COLUMNS)
    .eq('platform', platform)
    .eq('shop_domain', shopDomain)
    .eq('status', 'active')
    .order('installed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data ? toCredentials(data as unknown as ConnectionRow) : null
}

/** La conexión activa de una tienda por su id de plataforma (Tiendanube). */
export async function getStoreByExternalId(
  db: SupabaseClient,
  platform: CommercePlatform,
  externalStoreId: string,
): Promise<StoreCredentials | null> {
  const { data } = await db
    .from('shopify_connections')
    .select(SELECT_COLUMNS)
    .eq('platform', platform)
    .eq('external_store_id', externalStoreId)
    .eq('status', 'active')
    .order('installed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data ? toCredentials(data as unknown as ConnectionRow) : null
}

/** La conexión de un workspace para una plataforma (tarjeta de Ajustes, crons). */
export async function getStoreForWorkspace(
  db: SupabaseClient,
  platform: CommercePlatform,
  workspaceId: string,
): Promise<StoreCredentials | null> {
  const { data } = await db
    .from('shopify_connections')
    .select(SELECT_COLUMNS)
    .eq('platform', platform)
    .eq('workspace_id', workspaceId)
    .order('installed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data ? toCredentials(data as unknown as ConnectionRow) : null
}

/**
 * Vista pública de la conexión (sin secretos) para la tarjeta de Ajustes.
 * Se lee con el cliente de cookie, que por el grant de columnas de la
 * migración 126 no puede ver access_token / api_secret / webhook_secret.
 */
export interface PublicStoreConnection {
  id: string
  platform: CommercePlatform
  shop_domain: string
  shop_name: string | null
  store_url: string | null
  status: ConnectionStatus
  connection_method: ConnectionMethod
  currency: string | null
  installed_at: string | null
}

export async function getPublicConnection(
  db: SupabaseClient,
  platform: CommercePlatform,
  workspaceId: string,
): Promise<PublicStoreConnection | null> {
  const { data } = await db
    .from('shopify_connections')
    .select(
      'id, platform, shop_domain, shop_name, store_url, status, connection_method, currency, installed_at',
    )
    .eq('platform', platform)
    .eq('workspace_id', workspaceId)
    .order('installed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as PublicStoreConnection | null) ?? null
}

/**
 * Marca la conexión como expirada tras un 401. Sin esto la tarjeta de
 * Ajustes seguiría en verde sobre una credencial revocada mientras cada
 * consulta de pedido devuelve vacío y el agente le dice al cliente que
 * no tenemos registro de su compra.
 */
export async function markStoreExpired(
  db: SupabaseClient,
  platform: CommercePlatform,
  shopDomain: string,
  reason: string,
): Promise<void> {
  try {
    await db
      .from('shopify_connections')
      .update({ status: 'expired', last_error: reason.slice(0, 500) })
      .eq('platform', platform)
      .eq('shop_domain', shopDomain)
      .neq('status', 'expired')
  } catch {
    /* best-effort — no bloqueamos el throw del llamador */
  }
}

/** Marca la conexión como desinstalada (app/uninstalled). */
export async function markStoreUninstalled(
  db: SupabaseClient,
  platform: CommercePlatform,
  shopDomain: string,
): Promise<void> {
  await db
    .from('shopify_connections')
    .update({
      status: 'uninstalled',
      uninstalled_at: new Date().toISOString(),
    })
    .eq('platform', platform)
    .eq('shop_domain', shopDomain)
}

/** El secreto con el que se verifican los webhooks entrantes de esta tienda. */
export async function getStoreWebhookSecret(
  db: SupabaseClient,
  platform: CommercePlatform,
  shopDomain: string,
): Promise<string | null> {
  const { data } = await db
    .from('shopify_connections')
    .select('webhook_secret')
    // Sin filtro de status a propósito: `app/uninstalled` llega DESPUÉS de
    // que la conexión pasó a 'uninstalled' y aún hay que verificarlo.
    .eq('platform', platform)
    .eq('shop_domain', shopDomain)
    .order('installed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const secret = (data as { webhook_secret?: string | null } | null)?.webhook_secret
  if (!secret) return null
  try {
    return decrypt(secret)
  } catch {
    return null
  }
}
