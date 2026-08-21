/**
 * Adaptador de WooCommerce.
 *
 * WooCommerce no es un SaaS: es un plugin sobre WordPress alojado por el
 * comercio. Eso define todo lo de acá:
 *
 *  1. No hay OAuth central. La autenticación es un par
 *     consumer_key/consumer_secret por Basic auth sobre HTTPS. Se obtiene
 *     por el endpoint `/wc-auth/v1/authorize` (el comercio aprueba en su
 *     wp-admin y WooCommerce nos POSTea las claves) o pegándolas a mano.
 *
 *  2. Muchos hostings de WordPress descartan el header `Authorization`
 *     (Apache con CGI, sobre todo). WooCommerce documenta el fallback por
 *     query string justamente por eso, así que el cliente reintenta
 *     automáticamente ante un 401.
 *
 *  3. NO existe carrito abandonado en el core. Es una feature de plugin.
 *     La recuperación de carritos queda fuera para WooCommerce hasta que
 *     integremos alguno; los pedidos y el catálogo sí funcionan completos.
 *
 * A diferencia de Tiendanube, los webhooks SÍ traen el recurso entero, así
 * que el receptor no necesita volver a consultar la API.
 */

import { createHmac, timingSafeEqual } from 'crypto'
import type {
  NormalizedLineItem,
  NormalizedOrder,
  NormalizedProduct,
} from '../types'
import { StoreUnauthorizedError } from '../types'

/** Nombre con el que aparece Riverz en la pantalla de aprobación del comercio. */
export const WOO_APP_NAME = 'Riverz'

/**
 * Normaliza lo que escribe el comercio ("mitienda.com", "https://mitienda.com/",
 * "www.mitienda.com/tienda") al host limpio que usamos como clave de tienda.
 * Devuelve null si no parece un host válido.
 */
export function normalizeWooSiteUrl(input: string): string | null {
  if (!input) return null
  let s = input.trim().toLowerCase()
  s = s.replace(/^https?:\/\//, '')
  s = s.replace(/\/+$/, '')
  // Nos quedamos con el host: la ruta la agrega el cliente (/wp-json/...).
  // Un WordPress en subdirectorio ("midominio.com/tienda") queda fuera —
  // es raro y soportarlo a ciegas rompería el armado de URLs.
  s = s.split('/')[0]
  s = s.split('?')[0]
  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(s)) return null
  return s
}

// ── Comprobación previa del sitio ────────────────────────────────────

export type WooProbe =
  | { ok: true }
  /** No contesta, o no es un sitio servible. */
  | { ok: false; reason: 'unreachable' }
  /** Contesta, pero no hay WordPress detrás. */
  | { ok: false; reason: 'not_wordpress' }
  /** Hay WordPress, pero WooCommerce no está activo. */
  | { ok: false; reason: 'no_woocommerce' }
  /** Hay WordPress con enlaces permanentes en "Simple": las rutas mueren. */
  | { ok: false; reason: 'plain_permalinks' }

/**
 * Verifica que la dirección sea de verdad una tienda WooCommerce ANTES de
 * mandar al comercio a aprobar el acceso.
 *
 * Sin esto, cualquier error termina igual: el navegador aterriza en un
 * "404 Not Found" pelado en el sitio del comercio, sin una pista de qué
 * salió mal. Pasó con un dominio que no tenía WordPress: la persona hizo
 * todo bien y vio una página en blanco.
 *
 * REGLA: solo se rechaza con evidencia POSITIVA del problema. Ante la
 * duda se deja pasar. Muchas tiendas legítimas protegen o esconden la
 * raíz del REST —responden 401, 403 o directamente nada— y bloquearlas
 * sería peor que el 404: el 404 se puede sortear, un "tu sitio no sirve"
 * de nuestra parte no.
 *
 * `/wc-auth/` y `/wp-json/` las sirve el sistema de rutas de WordPress,
 * así que con enlaces permanentes en "Simple" ambas dan 404 aunque todo
 * esté instalado. Ese caso se distingue por `?rest_route=/`, que funciona
 * sin rutas amigables, y tiene arreglo de un clic del lado del comercio.
 */
export async function probeWooStore(siteUrl: string): Promise<WooProbe> {
  const get = async (url: string): Promise<{ status: number; body: string }> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
        redirect: 'follow',
      })
      // Nos alcanza con la cabecera del cuerpo: la raíz del REST puede
      // pesar cientos de kilobytes en sitios con muchos plugins.
      const body = (await res.text()).slice(0, 20000)
      return { status: res.status, body }
    } finally {
      clearTimeout(timer)
    }
  }

  const namespacesOf = (body: string): string[] | null => {
    try {
      const json = JSON.parse(body) as { namespaces?: unknown }
      return Array.isArray(json.namespaces) ? (json.namespaces as string[]) : null
    } catch {
      return null
    }
  }

  // Se comprueba la URL EXACTA a la que vamos a mandar al comercio. Es la
  // única señal que no se puede discutir: si acá da 404, en su navegador
  // también va a dar 404.
  //
  // Sin parámetros, un WooCommerce vivo responde con un error de la propia
  // pantalla de aprobación (401/400), nunca con 404. Y un cortafuegos que
  // nos bloquee contesta 403 o 503, tampoco 404 — por eso el 404 es
  // evidencia y el resto no.
  let auth: { status: number; body: string }
  try {
    auth = await get(`https://${siteUrl}/wc-auth/v1/authorize`)
  } catch {
    return { ok: false, reason: 'unreachable' }
  }
  if (auth.status !== 404) return { ok: true }

  // A partir de acá sabemos que NO va a funcionar. Lo que queda es
  // averiguar por qué, para poder decir algo útil.
  let root: { status: number; body: string } | null = null
  try {
    root = await get(`https://${siteUrl}/wp-json/`)
  } catch {
    /* seguimos con las otras señales */
  }

  const ns = root?.status === 200 ? namespacesOf(root.body) : null
  if (ns) {
    // El REST contesta pero la ruta de aprobación no existe: falta
    // WooCommerce. (Si estuviera, expondría su namespace y la ruta.)
    return { ok: false, reason: 'no_woocommerce' }
  }

  // La API por query string funciona sin rutas amigables: si responde,
  // hay WordPress y el problema son los enlaces permanentes.
  try {
    const alt = await get(`https://${siteUrl}/?rest_route=/`)
    if (alt.status === 200 && namespacesOf(alt.body)) {
      return { ok: false, reason: 'plain_permalinks' }
    }
  } catch {
    /* sigue el último chequeo */
  }

  // `wp-content` y `wp-includes` aparecen en el HTML de prácticamente
  // cualquier WordPress, incluso con el REST cerrado por un cortafuegos.
  try {
    const home = await get(`https://${siteUrl}/`)
    if (/wp-content|wp-includes/i.test(home.body)) {
      return { ok: false, reason: 'no_woocommerce' }
    }
  } catch {
    /* sin portada legible, nos quedamos con el diagnóstico de abajo */
  }

  return { ok: false, reason: 'not_wordpress' }
}

// ── Flujo /wc-auth ───────────────────────────────────────────────────

/**
 * URL de aprobación. `user_id` NO es el usuario de WordPress: es un
 * identificador NUESTRO que WooCommerce nos devuelve tal cual en el
 * callback. Como ese callback llega sin sesión ni firma de WooCommerce,
 * el `user_id` tiene que ser un token firmado e infalsificable — es lo
 * único que ata las claves entrantes a un workspace. Ver `signWooState`.
 */
export function buildWooAuthorizeUrl(args: {
  siteUrl: string
  state: string
  returnUrl: string
  callbackUrl: string
}): string {
  const params = new URLSearchParams({
    app_name: WOO_APP_NAME,
    // Necesitamos escritura: crear los webhooks al conectar y, más
    // adelante, que el asistente pueda cerrar pedidos.
    scope: 'read_write',
    user_id: args.state,
    return_url: args.returnUrl,
    callback_url: args.callbackUrl,
  })
  return `https://${args.siteUrl}/wc-auth/v1/authorize?${params.toString()}`
}

/** Lo que WooCommerce POSTea al `callback_url` una vez aprobado. */
export interface WooAuthCallback {
  key_id: number
  user_id: string
  consumer_key: string
  consumer_secret: string
  key_permissions: string
}

export function parseWooAuthCallback(body: unknown): WooAuthCallback | null {
  const b = body as Partial<WooAuthCallback> | null
  if (!b || typeof b.consumer_key !== 'string' || typeof b.consumer_secret !== 'string') {
    return null
  }
  return {
    key_id: Number(b.key_id ?? 0),
    user_id: String(b.user_id ?? ''),
    consumer_key: b.consumer_key,
    consumer_secret: b.consumer_secret,
    key_permissions: String(b.key_permissions ?? ''),
  }
}

// ── Verificación de webhooks ─────────────────────────────────────────

/**
 * WooCommerce firma la entrega con base64(HMAC-SHA256(cuerpo, secreto))
 * en `x-wc-webhook-signature`. El secreto lo elegimos nosotros al crear
 * el webhook y queda guardado en la conexión.
 */
export function verifyWooSignature(
  rawBody: string,
  header: string | null,
  secret: string,
): boolean {
  if (!header || !secret) return false
  const digest = createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64')
  try {
    const a = Buffer.from(digest, 'base64')
    const b = Buffer.from(header, 'base64')
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

// ── Cliente ──────────────────────────────────────────────────────────

export class WooCommerceClient {
  /** Se activa tras un 401 con Basic: el hosting come el header Authorization. */
  private useQueryAuth = false

  constructor(
    private readonly siteUrl: string,
    private readonly consumerKey: string,
    private readonly consumerSecret: string,
  ) {}

  private url(path: string, query?: Record<string, string | number>): string {
    const u = new URL(`https://${this.siteUrl}/wp-json/wc/v3${path}`)
    for (const [k, v] of Object.entries(query ?? {})) {
      u.searchParams.set(k, String(v))
    }
    if (this.useQueryAuth) {
      u.searchParams.set('consumer_key', this.consumerKey)
      u.searchParams.set('consumer_secret', this.consumerSecret)
    }
    return u.toString()
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (!this.useQueryAuth) {
      const basic = Buffer.from(
        `${this.consumerKey}:${this.consumerSecret}`,
        'utf8',
      ).toString('base64')
      h.Authorization = `Basic ${basic}`
    }
    return h
  }

  async request<T = unknown>(
    path: string,
    opts?: {
      method?: string
      body?: unknown
      query?: Record<string, string | number>
      /** Interno: evita reintentar en bucle el fallback de query string. */
      isRetry?: boolean
    },
  ): Promise<{ data: T; totalPages: number }> {
    const res = await fetch(this.url(path, opts?.query), {
      method: opts?.method ?? 'GET',
      headers: this.headers(),
      body: opts?.body ? JSON.stringify(opts.body) : undefined,
    })

    if (res.status === 401 && !this.useQueryAuth && !opts?.isRetry) {
      // El hosting descartó el header Authorization. Pasamos a query
      // string de forma permanente para esta instancia y reintentamos:
      // es el fallback que la propia documentación de WooCommerce
      // recomienda, no una heurística nuestra.
      this.useQueryAuth = true
      return this.request<T>(path, { ...opts, isRetry: true })
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      if (res.status === 401 || res.status === 403) {
        throw new StoreUnauthorizedError(
          'woocommerce',
          this.siteUrl,
          `WooCommerce ${res.status}: ${text.slice(0, 200)}`,
        )
      }
      throw new Error(`WooCommerce API ${res.status}: ${text.slice(0, 300)}`)
    }

    const totalPages = Number(res.headers.get('x-wp-totalpages') ?? '1')
    return {
      data: (await res.json()) as T,
      totalPages: Number.isFinite(totalPages) && totalPages > 0 ? totalPages : 1,
    }
  }

  async get<T = unknown>(
    path: string,
    query?: Record<string, string | number>,
  ): Promise<T> {
    return (await this.request<T>(path, { query })).data
  }

  /** Pagina un listado usando `X-WP-TotalPages` (per_page tope 100). */
  async paginate<T = unknown>(
    path: string,
    opts?: { perPage?: number; maxPages?: number; query?: Record<string, string | number> },
  ): Promise<T[]> {
    const perPage = Math.min(opts?.perPage ?? 100, 100)
    const maxPages = opts?.maxPages ?? 25
    const out: T[] = []
    let totalPages = 1
    for (let page = 1; page <= maxPages; page++) {
      const { data, totalPages: tp } = await this.request<T[]>(path, {
        query: { ...(opts?.query ?? {}), page, per_page: perPage },
      })
      totalPages = tp
      if (!Array.isArray(data) || data.length === 0) break
      out.push(...data)
      if (page >= totalPages) break
    }
    return out
  }

  /**
   * Nombre del sitio + moneda de la tienda. Vienen de dos lugares
   * distintos: el nombre del sitio lo expone la raíz del REST de
   * WordPress (pública) y la moneda los ajustes de WooCommerce (que
   * exigen permisos de administrador sobre la clave). Cada uno falla por
   * su cuenta sin tumbar la conexión: sin moneda el catálogo queda con
   * precios sin símbolo, sin nombre mostramos el dominio.
   */
  async getStoreInfo(): Promise<{ name: string; currency: string }> {
    let name = this.siteUrl
    let currency = ''
    try {
      const root = await fetch(`https://${this.siteUrl}/wp-json`, {
        headers: { Accept: 'application/json' },
      })
      if (root.ok) {
        const info = (await root.json()) as { name?: string }
        if (info?.name) name = info.name
      }
    } catch {
      /* el nombre es cosmético — seguimos con el dominio */
    }
    try {
      const settings = await this.get<Array<{ id?: string; value?: unknown }>>(
        '/settings/general',
      )
      currency = String(
        settings.find((s) => s.id === 'woocommerce_currency')?.value ?? '',
      )
    } catch {
      /* clave sin permiso sobre ajustes — no es motivo para fallar */
    }
    return { name, currency }
  }

  /**
   * Alta de los webhooks que consumimos, todos firmados con el mismo
   * secreto que guardamos en la conexión.
   *
   * WooCommerce NO deduplica por (topic, delivery_url): reconectar
   * crearía webhooks repetidos y cada pedido llegaría N veces. Por eso
   * primero listamos y borramos los nuestros anteriores.
   *
   * "Los nuestros" se reconoce por la RUTA, no por la URL entera: si el
   * servicio cambió de dominio, los del dominio viejo también son nuestros y
   * hay que darlos de baja. Comparando la URL completa quedaban vivos,
   * entregando cada pedido a un servidor muerto para siempre. Por eso volver a
   * llamar a esta función es además la forma de reconciliar la tienda.
   */
  async registerWebhooks(callbackBaseUrl: string, secret: string): Promise<void> {
    const deliveryUrl = `${callbackBaseUrl}${WOOCOMMERCE_WEBHOOK_PATH}`
    const topics = WOOCOMMERCE_WEBHOOK_TOPICS

    try {
      const existing = await this.paginate<{ id?: number; delivery_url?: string }>(
        '/webhooks',
        { perPage: 100, maxPages: 3 },
      )
      for (const w of existing) {
        if (!w.id || !w.delivery_url) continue
        let path: string
        try {
          path = new URL(w.delivery_url).pathname
        } catch {
          continue
        }
        if (path !== WOOCOMMERCE_WEBHOOK_PATH) continue
        await this.request(`/webhooks/${w.id}`, {
          method: 'DELETE',
          query: { force: 'true' },
        }).catch(() => {})
      }
    } catch (err) {
      // Si no podemos listar seguimos igual: peor es no registrar nada.
      console.error('[woocommerce] no se pudieron listar webhooks previos:', err)
    }

    for (const topic of topics) {
      try {
        await this.request('/webhooks', {
          method: 'POST',
          body: {
            name: `Riverz ${topic}`,
            topic,
            delivery_url: deliveryUrl,
            secret,
            status: 'active',
          },
        })
      } catch (err) {
        console.error(`[woocommerce] alta de webhook ${topic} falló:`, err)
      }
    }
  }
}

/** Ruta receptora, una para todos los temas. */
export const WOOCOMMERCE_WEBHOOK_PATH = '/api/woocommerce/webhooks'

export const WOOCOMMERCE_WEBHOOK_TOPICS = [
  'order.created',
  'order.updated',
  'customer.created',
  'customer.updated',
] as const

// ── Formas crudas ────────────────────────────────────────────────────

interface WooImage {
  src?: string
}

interface WooTerm {
  name?: string
}

interface WooProduct {
  id: number
  name?: string
  slug?: string
  permalink?: string
  description?: string
  short_description?: string
  type?: string
  status?: string
  price?: string
  regular_price?: string
  sale_price?: string
  categories?: WooTerm[]
  tags?: WooTerm[]
  images?: WooImage[]
}

interface WooLineItem {
  name?: string
  quantity?: number
  price?: number | string
  total?: string
  product_id?: number
  variation_id?: number
  image?: { src?: string }
}

interface WooAddress {
  first_name?: string
  last_name?: string
  address_1?: string
  address_2?: string
  city?: string
  state?: string
  postcode?: string
  country?: string
  email?: string
  phone?: string
}

export interface WooMeta {
  key?: string
  value?: unknown
}

interface WooOrder {
  id: number
  number?: string
  status?: string
  currency?: string
  total?: string
  discount_total?: string
  shipping_total?: string
  date_paid?: string | null
  date_completed?: string | null
  date_created?: string | null
  /** La misma fecha en UTC. Es la que sirve: ver `wooFechaAIso`. */
  date_created_gmt?: string | null
  billing?: WooAddress
  shipping?: WooAddress
  line_items?: WooLineItem[]
  customer_id?: number
  cart_hash?: string
  order_key?: string
  /** WooCommerce ya arma el link de pago; solo lo construimos si falta. */
  payment_url?: string
  meta_data?: WooMeta[]
}

function stripHtml(html: string): string {
  if (!html) return ''
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000)
}

function toNumber(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}

// ── Normalizadores ───────────────────────────────────────────────────

export function normalizeWooProduct(raw: unknown): NormalizedProduct | null {
  const p = raw as WooProduct
  if (!p || typeof p.id !== 'number') return null

  // Para productos variables WooCommerce devuelve `price` con el precio
  // de la variante más barata y no incluye las variantes en el payload.
  // Traerlas sería una request extra POR producto — inviable en tiendas
  // de cientos de SKUs — así que el rango colapsa al precio efectivo.
  const effective = toNumber(p.sale_price) ?? toNumber(p.price) ?? toNumber(p.regular_price)

  return {
    externalId: p.id,
    handle: p.slug || String(p.id),
    title: p.name || `#${p.id}`,
    description: stripHtml(p.description || p.short_description || ''),
    productType: p.categories?.[0]?.name ?? null,
    vendor: null,
    tags: (p.tags ?? []).map((t) => t.name ?? '').filter(Boolean),
    priceMin: effective,
    priceMax: effective,
    imageUrl: p.images?.[0]?.src ?? null,
    url: p.permalink ?? null,
    raw: p as unknown as Record<string, unknown>,
  }
}

function normalizeWooLineItems(items: unknown): NormalizedLineItem[] {
  if (!Array.isArray(items)) return []
  return (items as WooLineItem[]).map((li) => ({
    title: li.name ?? null,
    quantity: li.quantity ?? null,
    price: li.price != null ? String(li.price) : (li.total ?? null),
    variantId: li.variation_id || null,
    productId: li.product_id ?? null,
    imageUrl: li.image?.src ?? null,
  }))
}

/**
 * WooCommerce colapsa pago y envío en un solo `status`. Lo abrimos en el
 * par financial/fulfillment que usan las automatizaciones y los RPC de
 * transición.
 *
 * `processing` = pago recibido, todavía sin despachar (es el estado por
 * defecto de un pedido pagado). `completed` = despachado, y como
 * WooCommerce no permite completar sin cobrar, implica pagado.
 */
function normalizeWooState(status: string) {
  const s = (status || '').toLowerCase()
  switch (s) {
    case 'processing':
      return { financialStatus: 'paid', fulfillmentStatus: null, cancelled: false, delivered: false }
    case 'completed':
      return { financialStatus: 'paid', fulfillmentStatus: 'fulfilled', cancelled: false, delivered: false }
    case 'cancelled':
      return { financialStatus: null, fulfillmentStatus: null, cancelled: true, delivered: false }
    case 'refunded':
      return { financialStatus: 'refunded', fulfillmentStatus: null, cancelled: false, delivered: false }
    case 'failed':
      return { financialStatus: 'voided', fulfillmentStatus: null, cancelled: false, delivered: false }
    case 'pending':
    case 'on-hold':
    default:
      return { financialStatus: 'pending', fulfillmentStatus: null, cancelled: false, delivered: false }
  }
}

export interface WooTracking {
  number: string
  company: string
  url: string
}

/**
 * El seguimiento no existe en el core de WooCommerce: lo agregan plugins
 * que lo guardan en `meta_data`. Leemos las claves de los más usados
 * (WooCommerce Shipment Tracking, AST) y, si no hay ninguna, devolvemos
 * vacío — la automatización de tracking simplemente no dispara.
 *
 * Es la ÚNICA lectura del seguimiento de WooCommerce que hay. Había otra en
 * `order-lookup.ts` que miraba claves distintas (`_shipping_provider`,
 * `_tracking_url`) y por eso el mismo pedido mostraba el número de
 * seguimiento por el camino del webhook y no por el de "¿dónde está mi
 * pedido?", que es justo donde el cliente lo pide.
 */
export function extractWooTracking(meta: WooMeta[] | undefined): WooTracking {
  const empty = { number: '', company: '', url: '' }
  if (!Array.isArray(meta)) return empty
  const find = (keys: string[]): string => {
    for (const m of meta) {
      if (m.key && keys.includes(m.key) && typeof m.value === 'string' && m.value) {
        return m.value
      }
    }
    return ''
  }
  const direct = {
    number: find(['_tracking_number', 'tracking_number']),
    company: find([
      '_tracking_provider',
      'tracking_provider',
      '_custom_tracking_provider',
      '_shipping_provider',
    ]),
    url: find(['_custom_tracking_link', 'tracking_url', '_tracking_url']),
  }
  if (direct.number) return direct

  // Shipment Tracking guarda un array serializado en una sola clave.
  for (const m of meta) {
    if (m.key !== '_wc_shipment_tracking_items' || !Array.isArray(m.value)) continue
    const first = (m.value as Array<Record<string, unknown>>)[0]
    if (!first) continue
    return {
      number: String(first.tracking_number ?? ''),
      company: String(first.tracking_provider ?? first.custom_tracking_provider ?? ''),
      url: String(first.custom_tracking_link ?? ''),
    }
  }
  return empty
}

/**
 * La fecha del pedido, en UTC.
 *
 * WooCommerce manda `date_created` en la zona de la tienda y SIN sufijo, así
 * que quien la lea la va a interpretar en la suya: un pedido de una tienda en
 * Buenos Aires aparecía tres horas corrido, y con eso caía en el día —o en la
 * ventana de atribución— equivocado. Al lado viene `date_created_gmt`, que es
 * el mismo instante en UTC y sólo le falta la Z.
 */
export function wooFechaAIso(
  local: string | null | undefined,
  gmt: string | null | undefined,
): string | null {
  const conZ = (v: string) => (/[zZ]|[+-]\d{2}:?\d{2}$/.test(v) ? v : `${v}Z`)
  if (gmt && gmt.trim()) return conZ(gmt.trim())
  // Sin la versión GMT no hay forma de saber el desfase de la tienda; se
  // asume UTC, que es lo mismo que hacía antes pero dicho en voz alta.
  if (local && local.trim()) return conZ(local.trim())
  return null
}

/**
 * Link para terminar de pagar un pedido que quedó sin cobrar.
 *
 * WooCommerce lo devuelve en `payment_url`, pero ese campo no está en
 * todas las versiones ni en todos los payloads de webhook, así que lo
 * reconstruimos: `/checkout/order-pay/{id}/?pay_for_order=true&key=…`.
 * El `order_key` es lo que autoriza al comprador a abrir un pedido ajeno
 * sin tener sesión — sin él, el link lleva a un error.
 */
export function buildWooPayUrl(
  siteUrl: string,
  order: { id: number; order_key?: string; payment_url?: string },
): string {
  if (order.payment_url) return order.payment_url
  if (!order.order_key || !siteUrl) return ''
  return (
    `https://${siteUrl}/checkout/order-pay/${order.id}/` +
    `?pay_for_order=true&key=${encodeURIComponent(order.order_key)}`
  )
}

export function normalizeWooOrder(
  raw: unknown,
  ctx?: { siteUrl?: string },
): NormalizedOrder | null {
  const o = raw as WooOrder
  if (!o || typeof o.id !== 'number') return null

  const billing = o.billing ?? {}
  const shipping = o.shipping ?? {}
  const name =
    [shipping.first_name, shipping.last_name].filter(Boolean).join(' ') ||
    [billing.first_name, billing.last_name].filter(Boolean).join(' ')

  const total = toNumber(o.total) ?? 0
  const discount = toNumber(o.discount_total) ?? 0
  const tracking = extractWooTracking(o.meta_data)

  return {
    externalId: o.id,
    name: `#${o.number ?? o.id}`,
    orderNumber: String(o.number ?? o.id),
    totalPrice: String(o.total ?? ''),
    // WooCommerce no manda subtotal a nivel pedido; lo reconstruimos
    // desde el total menos descuentos para que las variables de las
    // plantillas no queden vacías.
    subtotalPrice: String(total + discount),
    totalDiscounts: String(o.discount_total ?? ''),
    currency: o.currency ?? '',
    lineItems: normalizeWooLineItems(o.line_items),
    customer: {
      name: name || null,
      email: billing.email || null,
      // El envío no lleva teléfono/email en el core; la facturación sí.
      phone: billing.phone || shipping.phone || null,
      countryCode: shipping.country || billing.country || null,
      ordersCount: 0,
    },
    shippingAddress: {
      address: [shipping.address_1 || billing.address_1, shipping.address_2 || billing.address_2]
        .filter((p) => p && String(p).trim())
        .join(', '),
      city: shipping.city || billing.city || '',
      province: shipping.state || billing.state || '',
      zip: shipping.postcode || billing.postcode || '',
      country: shipping.country || billing.country || '',
    },
    state: normalizeWooState(o.status ?? ''),
    orderStatusUrl: '',
    payUrl: buildWooPayUrl(ctx?.siteUrl ?? '', o),
    trackingNumber: tracking.number,
    trackingCompany: tracking.company,
    trackingUrl: tracking.url,
    checkoutToken: o.cart_hash || null,
    createdAt: wooFechaAIso(o.date_created, o.date_created_gmt),
    raw: o as unknown as Record<string, unknown>,
  }
}
