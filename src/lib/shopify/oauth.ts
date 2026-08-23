/**
 * Shopify OAuth + webhook crypto helpers. Ported from the Riverz app's
 * lib/shopify/oauth.ts, adapted to this app (Supabase auth, env names).
 *
 * Token type: tokens stored here are offline-access (non-expiring).
 * The Shopify Admin API response carries no expires_in for this flow —
 * the field is null/absent and the token is valid until the merchant
 * uninstalls the app. If we ever request online tokens (per-user,
 * embedded admin UI), we'll need a refresh strategy and to start
 * persisting expires_in.
 *
 * Two distinct HMAC schemes:
 *  - OAuth callback: hex HMAC-SHA256 over the sorted query string (minus
 *    the `hmac` param).
 *  - Webhooks: base64 HMAC-SHA256 over the raw request body.
 */

import { createHmac, timingSafeEqual } from 'crypto'

const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-10'
// `write_orders` habilita que el asistente IA cree pedidos reales
// (src/lib/shopify/create-order.ts). Las tiendas conectadas con el set
// viejo (solo lectura) deben RECONECTAR para otorgarlo — hasta entonces
// la tool create_order devuelve missing_write_scope y no crea nada.
//
// Fulfillments: el tracking que usa la automatización "Enviar tracking" ya
// viene dentro del webhook orders/updated, así que para LEERLO no hace falta
// scope extra. Los de fulfillment habilitan además despachar desde Riverz y
// poder validar el flujo end-to-end contra una tienda real (sin ellos la
// Admin API responde 403 al crear el fulfillment).
const DEFAULT_SCOPES =
  process.env.SHOPIFY_SCOPES ||
  [
    'read_orders',
    'write_orders',
    'read_checkouts',
    'read_customers',
    'read_products',
    'read_fulfillments',
    'write_fulfillments',
    'read_merchant_managed_fulfillment_orders',
    'write_merchant_managed_fulfillment_orders',
    // Descuentos: `ensureCampaignPriceRule` (instagram-agent/discounts.ts) crea
    // price rules y códigos únicos desde que existe, pero sin este scope Shopify
    // contesta 403 y el `catch` lo devuelve como null — o sea que la función
    // estaba fallando en silencio en todas las tiendas conectadas.
    'write_discounts',
    // Chat web: instalarlo sin que nadie toque el código del tema. Copiar un
    // snippet a `theme.liquid` es el paso donde se cae la adopción — el
    // comercio que conectó la tienda en dos clics tiene que abrir el editor de
    // código, y la mitad no lo hace.
    // Los dos: Shopify pide `read_script_tags` para LISTAR los que ya hay,
    // que es como se sabe si el chat está puesto. Con sólo el de escritura
    // contesta 403 "requires merchant approval for read_script_tags scope" y
    // el botón de instalar no puede ni preguntar.
    'read_script_tags',
    'write_script_tags',
  ].join(',')

export function shopifyApiVersion(): string {
  return API_VERSION
}

export function shopifyScopes(): string {
  return DEFAULT_SCOPES
}

/**
 * Normalize user input into a canonical `*.myshopify.com` domain, or
 * return null if it doesn't look like a valid shop.
 */
export function normalizeShopDomain(input: string): string | null {
  if (!input) return null
  let s = input.trim().toLowerCase()
  s = s.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  // Accept "mystore" shorthand → mystore.myshopify.com
  if (!s.includes('.')) s = `${s}.myshopify.com`
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s)) return null
  return s
}

export function buildAuthorizeUrl(args: {
  shop: string
  state: string
  apiKey: string
  redirectUri: string
  scopes?: string
}): string {
  const params = new URLSearchParams({
    client_id: args.apiKey,
    scope: args.scopes || DEFAULT_SCOPES,
    redirect_uri: args.redirectUri,
    state: args.state,
  })
  return `https://${args.shop}/admin/oauth/authorize?${params.toString()}`
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, 'hex')
    const bb = Buffer.from(b, 'hex')
    if (ba.length !== bb.length) return false
    return timingSafeEqual(ba, bb)
  } catch {
    return false
  }
}

function safeEqualBase64(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, 'base64')
    const bb = Buffer.from(b, 'base64')
    if (ba.length !== bb.length) return false
    return timingSafeEqual(ba, bb)
  } catch {
    return false
  }
}

/** Verify the HMAC on an OAuth callback (hex, over the sorted query). */
export function verifyOAuthHmac(
  params: URLSearchParams,
  apiSecret: string,
): boolean {
  const hmac = params.get('hmac')
  if (!hmac) return false
  const pairs: string[] = []
  for (const [key, value] of params.entries()) {
    if (key === 'hmac' || key === 'signature') continue
    pairs.push(`${key}=${value}`)
  }
  pairs.sort()
  const message = pairs.join('&')
  const digest = createHmac('sha256', apiSecret).update(message).digest('hex')
  return safeEqualHex(digest, hmac)
}

/** Verify the HMAC on a webhook delivery (base64, over the raw body). */
export function verifyWebhookHmac(
  rawBody: string,
  headerHmac: string | null,
  apiSecret: string,
): boolean {
  if (!headerHmac) return false
  const digest = createHmac('sha256', apiSecret)
    .update(rawBody, 'utf8')
    .digest('base64')
  return safeEqualBase64(digest, headerHmac)
}

/**
 * Exchange the OAuth `code` for a permanent Admin API access token.
 * Returns the offline-access token + granted scope. `expires_in` is
 * intentionally null for offline tokens — Shopify omits it from the
 * response, so callers must NOT treat its absence as an error.
 */
export async function exchangeCodeForToken(args: {
  shop: string
  code: string
  apiKey: string
  apiSecret: string
}): Promise<{ access_token: string; scope: string; expires_in: number | null }> {
  const res = await fetch(`https://${args.shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: args.apiKey,
      client_secret: args.apiSecret,
      code: args.code,
    }),
  })
  if (!res.ok) {
    throw new Error(`Shopify token exchange failed: ${res.status}`)
  }
  const data = await res.json()
  if (!data.access_token) throw new Error('No access_token in Shopify response')
  const expiresIn =
    typeof data.expires_in === 'number' && Number.isFinite(data.expires_in)
      ? data.expires_in
      : null
  return {
    access_token: data.access_token,
    scope: data.scope ?? '',
    expires_in: expiresIn,
  }
}
