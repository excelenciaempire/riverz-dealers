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

import { createHmac, timingSafeEqual } from 'crypto';

const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-10';
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
const PUBLIC_SCOPES = [
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
    //
    // `write_discounts` NO alcanza, y no es un detalle de nombre: gobierna la
    // API de Discounts (GraphQL), y este código usa la de PriceRules (REST).
    // Con sólo aquél, crear la regla contesta "requires merchant approval for
    // write_price_rules scope" y listar las existentes pide la de lectura
    // aparte — escribir no implica leer, igual que con las etiquetas de script.
    // Los tres, entonces. Medido el 2026-08-24 sobre la tienda demo ya
    // reconectada, donde `write_discounts` solo daba 403 en las dos.
    'read_price_rules',
    'write_price_rules',
    'write_discounts',
    // Editar un pedido ya creado (sumarle unidades) NO entra en `write_orders`:
    // Shopify separó `orderEditBegin` en su propio permiso. Con sólo aquél
    // contesta 200 con `errors: ACCESS_DENIED, requires write_order_edits`, que
    // la capa de arriba devolvía como un "no pude actualizar" genérico — la
    // herramienta update_order no funcionó nunca en ninguna tienda conectada
    // por OAuth. Medido el 2026-08-24 sobre la tienda demo, pedido #1002.
    'read_order_edits',
    'write_order_edits',
    // Borradores de pedido ("Pedidos → Borradores"). Un borrador es una venta
    // que el comercio YA armó —cliente, productos y un `invoice_url` que es un
    // link de pago listo— esperando que alguien pague. Es un carrito
    // abandonado más caliente: acá alguien del equipo ya habló con la persona.
    // Sin este permiso `draft_orders.json` contesta 403 "requires merchant
    // approval for read_draft_orders scope" y los webhooks del tema ni se
    // pueden registrar, así que esas ventas eran invisibles.
    'read_draft_orders',
  ]

const LEGACY_ONLY_SCOPES = [
  // Sólo la app legacy instalada en Pilar los necesita: write_products crea
  // el producto UNLISTED del laboratorio; ScriptTags permite retirar el
  // cargador anterior al activar la Theme App Extension. Inventario y
  // ubicaciones sólo sirven para darle stock propio al duplicado: Shopify
  // copia el saldo negativo del producto fuente y lo marca como agotado.
  'write_products',
  'read_inventory',
  'write_inventory',
  'read_locations',
  'read_publications',
  'write_publications',
  'read_script_tags',
  'write_script_tags',
]

export function shopifyApiVersion(): string {
  return API_VERSION;
}

export function shopifyScopes(identity: 'public' | 'legacy' = 'public'): string {
  const configured = process.env.SHOPIFY_SCOPES
  const base = configured
    ? configured.split(',').map((scope) => scope.trim()).filter(Boolean)
    : PUBLIC_SCOPES
  const publicOnly = base.filter((scope) => !LEGACY_ONLY_SCOPES.includes(scope))
  return Array.from(
    new Set(identity === 'legacy' ? [...publicOnly, ...LEGACY_ONLY_SCOPES] : publicOnly),
  ).join(',')
}

/**
 * Normalize user input into a canonical `*.myshopify.com` domain, or
 * return null if it doesn't look like a valid shop.
 */
export function normalizeShopDomain(input: string): string | null {
  if (!input) return null;
  let s = input.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  // Accept "mystore" shorthand → mystore.myshopify.com
  if (!s.includes('.')) s = `${s}.myshopify.com`;
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s)) return null;
  return s;
}

export function buildAuthorizeUrl(args: {
  shop: string;
  state: string;
  apiKey: string;
  redirectUri: string;
  scopes?: string;
}): string {
  const params = new URLSearchParams({
    client_id: args.apiKey,
    scope: args.scopes || shopifyScopes(),
    redirect_uri: args.redirectUri,
    state: args.state,
  });
  return `https://${args.shop}/admin/oauth/authorize?${params.toString()}`;
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

function safeEqualBase64(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, 'base64');
    const bb = Buffer.from(b, 'base64');
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

/** Verify the HMAC on an OAuth callback (hex, over the sorted query). */
export function verifyOAuthHmac(
  params: URLSearchParams,
  apiSecret: string
): boolean {
  const hmac = params.get('hmac');
  if (!hmac) return false;
  const pairs: string[] = [];
  for (const [key, value] of params.entries()) {
    if (key === 'hmac' || key === 'signature') continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const message = pairs.join('&');
  const digest = createHmac('sha256', apiSecret).update(message).digest('hex');
  return safeEqualHex(digest, hmac);
}

/** Verify the HMAC on a webhook delivery (base64, over the raw body). */
export function verifyWebhookHmac(
  rawBody: string,
  headerHmac: string | null,
  apiSecret: string
): boolean {
  if (!headerHmac) return false;
  const digest = createHmac('sha256', apiSecret)
    .update(rawBody, 'utf8')
    .digest('base64');
  return safeEqualBase64(digest, headerHmac);
}

export interface TokenDeShopify {
  access_token: string;
  scope: string;
  /** Segundos de vida. 3600 para los que expiran; null para los viejos. */
  expires_in: number | null;
  /** Con esto se renueva sin tocar al comercio. Null en los viejos. */
  refresh_token: string | null;
  /** Segundos de vida del refresh (90 días). */
  refresh_token_expires_in: number | null;
}

function leerToken(data: Record<string, unknown>): TokenDeShopify {
  if (!data.access_token)
    throw new Error('No access_token in Shopify response');
  const num = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  return {
    access_token: String(data.access_token),
    scope: typeof data.scope === 'string' ? data.scope : '',
    expires_in: num(data.expires_in),
    refresh_token:
      typeof data.refresh_token === 'string' && data.refresh_token
        ? data.refresh_token
        : null,
    refresh_token_expires_in: num(data.refresh_token_expires_in),
  };
}

/**
 * Canjear el `code` del OAuth por el token de la Admin API.
 *
 * `expiring: 1` es todo el cambio, y no es opcional: Shopify dio de baja los
 * tokens que no expiran, y sin ese parámetro emite uno de los viejos que su
 * propia API después rechaza. Medido el 2026-08-24 sobre dos tiendas conectadas
 * ese día —una recién reconectada por OAuth completo— que fallaban un simple
 * `/shop.json` con "Non-expiring access tokens are no longer accepted".
 *
 * A cambio, el token dura una hora y viene con un `refresh_token` de 90 días.
 * Renovarlo es cosa del servidor: el comercio no vuelve a ver una pantalla.
 */
export async function exchangeCodeForToken(args: {
  shop: string;
  code: string;
  apiKey: string;
  apiSecret: string;
}): Promise<TokenDeShopify> {
  const res = await fetch(`https://${args.shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      client_id: args.apiKey,
      client_secret: args.apiSecret,
      code: args.code,
      expiring: '1',
    }),
  });
  if (!res.ok) {
    throw new Error(`Shopify token exchange failed: ${res.status}`);
  }
  return leerToken(await res.json());
}

/**
 * Renovar un token vencido con su refresh token.
 *
 * Shopify devuelve un refresh NUEVO en cada renovación, así que hay que
 * guardarlo: quedarse con el viejo funciona una vez y a la siguiente deja la
 * tienda afuera, noventa días después, sin que nadie haya tocado nada.
 */
export async function refreshShopifyToken(args: {
  shop: string;
  refreshToken: string;
  apiKey: string;
  apiSecret: string;
}): Promise<TokenDeShopify> {
  const res = await fetch(`https://${args.shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      client_id: args.apiKey,
      client_secret: args.apiSecret,
      grant_type: 'refresh_token',
      refresh_token: args.refreshToken,
    }),
  });
  if (!res.ok) {
    const texto = await res.text().catch(() => '');
    throw new Error(
      `Shopify token refresh failed: ${res.status} ${texto.slice(0, 200)}`
    );
  }
  return leerToken(await res.json());
}

/**
 * Obtiene el token de una app instalada desde Shopify Dev Dashboard.
 *
 * Estos tokens duran 24 horas. No llevan refresh token: se pide otro con el
 * mismo client id y client secret cuando está por vencer.
 */
export async function exchangeClientCredentialsForToken(args: {
  shop: string;
  clientId: string;
  clientSecret: string;
}): Promise<TokenDeShopify> {
  const res = await fetch(`https://${args.shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: args.clientId,
      client_secret: args.clientSecret,
    }),
  });
  if (!res.ok) {
    const texto = await res.text().catch(() => '');
    throw new Error(
      `Shopify client credentials exchange failed: ${res.status} ${texto.slice(0, 200)}`
    );
  }
  return leerToken(await res.json());
}
