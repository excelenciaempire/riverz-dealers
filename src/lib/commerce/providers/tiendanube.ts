/**
 * Adaptador de Tiendanube / Nuvemshop.
 *
 * Tres cosas la separan de Shopify y explican casi todo el código de acá:
 *
 *  1. El id de tienda va en la URL de CADA request
 *     (`https://api.tiendanube.com/{version}/{store_id}/...`), no en un
 *     host por tienda. Sin `external_store_id` la conexión es inservible.
 *
 *  2. Los webhooks NO traen el recurso: el cuerpo es
 *     `{ store_id, event, id }` y hay que ir a buscar el pedido por API.
 *     Por eso el receptor necesita credenciales válidas para procesar
 *     cualquier evento — a diferencia de Shopify, que manda el pedido
 *     entero firmado.
 *
 *  3. No existe webhook de carrito abandonado. La plataforma expone
 *     `GET /checkouts` y el carrito aparece recién cuando el cliente
 *     llegó al segundo paso del checkout, hasta 6 horas después del
 *     abandono. La recuperación es por polling (cron), no por push.
 *
 * Los textos (`name`, `description`, `handle`) son objetos por idioma:
 * `{ "es": "Remera", "pt": "Camiseta" }`. `pickLocalized` los aplana
 * usando el idioma principal de la tienda.
 */

import type {
  NormalizedCheckout,
  NormalizedLineItem,
  NormalizedOrder,
  NormalizedProduct,
} from '../types'
import { StoreUnauthorizedError } from '../types'

const API_VERSION = process.env.TIENDANUBE_API_VERSION || '2025-03'

/**
 * Tiendanube RECHAZA con 400 cualquier request sin User-Agent con
 * formato "App (contacto)". No es opcional ni un nice-to-have.
 */
function userAgent(): string {
  // Debe coincidir con el correo de contacto registrado en el portal de
  // socios: es el dato que Tiendanube espera ver identificando a la app.
  return (
    process.env.TIENDANUBE_USER_AGENT ||
    'Riverz (riverzoficial@gmail.com)'
  )
}

export function tiendanubeAppId(): string | null {
  return process.env.TIENDANUBE_APP_ID || null
}

export function tiendanubeConfigured(): boolean {
  return Boolean(process.env.TIENDANUBE_APP_ID && process.env.TIENDANUBE_CLIENT_SECRET)
}

/**
 * Los permisos sin los cuales la integración no funciona.
 *
 * NO se piden en la URL de autorización: los fija la app en el portal de
 * partners y Tiendanube los devuelve ya otorgados en el canje del token. Acá
 * sirven para comprobarlos (`missingTiendanubeScopes`), que es lo único que
 * avisa cuando alguien cambia los permisos en el portal — de otro modo la
 * conexión queda verde y lo que falla es una función suelta, semanas después.
 */
export const TIENDANUBE_SCOPES = [
  'read_products',
  'read_orders',
  'write_orders',
  'read_customers',
] as const

/** Los permisos requeridos que el token NO trae. */
export function missingTiendanubeScopes(granted: string | null | undefined): string[] {
  // Tiendanube los devuelve separados por coma o por espacio según la versión.
  const tiene = new Set(
    String(granted ?? '')
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  )
  // Sin scope declarado no hay nada que comprobar: dar la conexión por rota
  // sería peor que confiar en el portal.
  if (tiene.size === 0) return []
  return TIENDANUBE_SCOPES.filter((s) => !tiene.has(s))
}

// ── OAuth ────────────────────────────────────────────────────────────

/**
 * URL de autorización. Ojo: Tiendanube NO acepta `redirect_uri` acá —
 * la URL de retorno se fija en la configuración de la app en el portal
 * de partners. Si el callback no coincide con lo configurado allá, el
 * flujo muere del lado de ellos sin que podamos detectarlo. Los permisos
 * viajan por el mismo camino: tampoco se piden por query.
 */
export function buildTiendanubeAuthorizeUrl(appId: string, state: string): string {
  return `https://www.tiendanube.com/apps/${encodeURIComponent(appId)}/authorize?state=${encodeURIComponent(state)}`
}

export interface TiendanubeToken {
  accessToken: string
  /** Id de la tienda. Tiendanube lo llama `user_id`, pero es la TIENDA. */
  storeId: string
  scope: string
}

/**
 * Canjea el `code` por un token permanente. Los tokens de Tiendanube no
 * expiran: valen hasta que se emite uno nuevo o el comercio desinstala
 * la app, así que no hay refresh que manejar.
 */
export async function exchangeTiendanubeCode(args: {
  code: string
  clientId: string
  clientSecret: string
}): Promise<TiendanubeToken> {
  const res = await fetch('https://www.tiendanube.com/apps/authorize/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': userAgent(),
    },
    // La documentación es explícita: los datos van en el CUERPO, no como
    // parámetros de query.
    body: JSON.stringify({
      client_id: args.clientId,
      client_secret: args.clientSecret,
      grant_type: 'authorization_code',
      code: args.code,
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Tiendanube token exchange ${res.status}: ${text.slice(0, 300)}`)
  }
  const data = (await res.json()) as {
    access_token?: string
    user_id?: number | string
    scope?: string
  }
  if (!data.access_token || data.user_id == null) {
    throw new Error('Respuesta de Tiendanube sin access_token/user_id')
  }
  const faltan = missingTiendanubeScopes(data.scope)
  if (faltan.length > 0) {
    // No se corta la conexión: lo que el token sí trae sigue sirviendo, y
    // negarle la instalación al comercio por un permiso que él no controla
    // sería peor. El log es el único aviso de que el portal cambió.
    console.error('[tiendanube] permisos faltantes en el token:', faltan.join(', '))
  }
  return {
    accessToken: data.access_token,
    storeId: String(data.user_id),
    scope: data.scope ?? '',
  }
}

// ── Cliente ──────────────────────────────────────────────────────────

/**
 * Error de la API con el código HTTP a mano.
 *
 * Hace falta para separar el 422 de "ese webhook ya existe" —que es el
 * resultado NORMAL de reconectar— de un 422 de verdad. Antes los dos
 * terminaban en el mismo `console.error` y en el mismo "listo": una tienda
 * podía quedarse sin webhooks y el alta figuraba como exitosa.
 */
export class TiendanubeApiError extends Error {
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(`Tiendanube API ${status}: ${detail}`)
    this.name = 'TiendanubeApiError'
  }
}

/** Tiendanube contesta 422 cuando el par (url, event) ya está registrado. */
function esWebhookRepetido(err: unknown): boolean {
  return err instanceof TiendanubeApiError && err.status === 422
}

export class TiendanubeClient {
  constructor(
    private readonly storeId: string,
    private readonly token: string,
    private readonly shopDomain: string,
  ) {}

  private base(): string {
    return `https://api.tiendanube.com/${API_VERSION}/${this.storeId}`
  }

  async request<T = unknown>(
    path: string,
    init?: { method?: string; body?: unknown },
  ): Promise<{ data: T; totalCount: number | null }> {
    const res = await fetch(`${this.base()}${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        // La documentación vigente pide `Authorization: Bearer`. Las
        // generaciones anteriores de la API usaban `Authentication:
        // bearer`. Mandamos ambos: la tienda que responda a la vieja
        // sigue funcionando y la nueva ignora el header de más.
        Authorization: `Bearer ${this.token}`,
        Authentication: `bearer ${this.token}`,
        'User-Agent': userAgent(),
        'Content-Type': 'application/json',
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      if (res.status === 401) {
        throw new StoreUnauthorizedError(
          'tiendanube',
          this.shopDomain,
          `Tiendanube 401: ${text.slice(0, 200)}`,
        )
      }
      throw new TiendanubeApiError(res.status, text.slice(0, 300))
    }
    // 204 en DELETE y en algunos POST — no intentar parsear.
    const totalRaw = res.headers.get('x-total-count')
    const totalCount = totalRaw != null ? Number(totalRaw) : null
    if (res.status === 204) {
      return { data: undefined as T, totalCount }
    }
    return {
      data: (await res.json()) as T,
      totalCount: Number.isFinite(totalCount as number) ? totalCount : null,
    }
  }

  async get<T = unknown>(path: string): Promise<T> {
    return (await this.request<T>(path)).data
  }

  /**
   * Pagina un listado. Tiendanube usa `page`/`per_page` (máximo 200) y
   * limita a 2 req/s con un bucket de 40, así que el tope de páginas es
   * una protección real contra quedarnos colgados en una tienda grande,
   * no una hipótesis.
   */
  async paginate<T = unknown>(
    path: string,
    opts?: { perPage?: number; maxPages?: number },
  ): Promise<T[]> {
    const perPage = opts?.perPage ?? 200
    const maxPages = opts?.maxPages ?? 15
    const out: T[] = []
    for (let page = 1; page <= maxPages; page++) {
      const sep = path.includes('?') ? '&' : '?'
      const batch = await this.get<T[]>(
        `${path}${sep}page=${page}&per_page=${perPage}`,
      )
      if (!Array.isArray(batch) || batch.length === 0) break
      out.push(...batch)
      if (batch.length < perPage) break
    }
    return out
  }

  async getStore(): Promise<TiendanubeStore> {
    return this.get<TiendanubeStore>('/store')
  }

  /**
   * Registra los webhooks que necesitamos. Idempotente: Tiendanube devuelve
   * 422 si (url, event) ya existe y eso es éxito —reconectar no debe romper
   * por webhooks que ya están puestos—, pero cualquier otro fallo se cuenta
   * como fallo y queda en el resultado.
   *
   * No incluye carritos: la plataforma no emite ese evento (ver el cron
   * de recuperación).
   */
  async registerWebhooks(
    callbackBaseUrl: string,
  ): Promise<{ creados: number; existentes: number; fallidos: string[] }> {
    const url = `${callbackBaseUrl}${TIENDANUBE_WEBHOOK_PATH}`
    let creados = 0
    let existentes = 0
    const fallidos: string[] = []
    for (const event of TIENDANUBE_WEBHOOK_EVENTS) {
      try {
        await this.request('/webhooks', { method: 'POST', body: { event, url } })
        creados++
      } catch (err) {
        if (esWebhookRepetido(err)) {
          existentes++
          continue
        }
        fallidos.push(event)
        console.error(`[tiendanube] alta de webhook ${event} falló:`, err)
      }
    }
    return { creados, existentes, fallidos }
  }

  /**
   * Deja la tienda con los webhooks apuntando al dominio actual.
   *
   * `registerWebhooks` sólo da de alta: si el servicio cambia de dominio, los
   * viejos siguen registrados y Tiendanube entrega cada pedido a un servidor
   * muerto sin que falle nada de este lado. Acá se dan de baja los que apuntan
   * a otro origen —sólo los de NUESTRA ruta— y se re-registra lo que falte.
   */
  async reconcileWebhooks(callbackBaseUrl: string): Promise<{
    deleted: number
    created: number
    kept: number
  }> {
    const base = callbackBaseUrl.replace(/\/+$/, '')
    const wanted = `${base}${TIENDANUBE_WEBHOOK_PATH}`
    let live: Array<{ id?: number; event?: string; url?: string }> = []
    try {
      live = await this.get<Array<{ id?: number; event?: string; url?: string }>>('/webhooks')
    } catch (err) {
      console.error('[tiendanube] no se pudieron listar los webhooks:', err)
      return { deleted: 0, created: 0, kept: 0 }
    }

    let deleted = 0
    let kept = 0
    const present = new Set<string>()
    for (const w of Array.isArray(live) ? live : []) {
      if (!w.url || !w.event) continue
      let path: string
      try {
        path = new URL(w.url).pathname
      } catch {
        continue
      }
      if (path !== TIENDANUBE_WEBHOOK_PATH) continue
      if (w.url === wanted) {
        present.add(w.event)
        kept++
        continue
      }
      if (w.id == null) continue
      try {
        await this.request(`/webhooks/${w.id}`, { method: 'DELETE' })
        deleted++
      } catch (err) {
        console.error(`[tiendanube] baja de webhook ${w.event} falló:`, err)
      }
    }

    let created = 0
    for (const event of TIENDANUBE_WEBHOOK_EVENTS) {
      if (present.has(event)) continue
      try {
        await this.request('/webhooks', {
          method: 'POST',
          body: { event, url: wanted },
        })
        created++
      } catch (err) {
        // El 422 acá significa que el listado no lo mostró pero ya estaba: se
        // cuenta como conservado, no como creado ni como caído.
        if (esWebhookRepetido(err)) {
          kept++
          continue
        }
        console.error(`[tiendanube] realta de webhook ${event} falló:`, err)
      }
    }
    return { deleted, created, kept }
  }
}

/** Ruta receptora. Una sola para todos los eventos. */
export const TIENDANUBE_WEBHOOK_PATH = '/api/tiendanube/webhooks'

/** No incluye carritos: la plataforma no emite ese evento (ver el cron de
 *  recuperación). */
export const TIENDANUBE_WEBHOOK_EVENTS = [
  'order/created',
  'order/paid',
  'order/fulfilled',
  'order/cancelled',
  'order/updated',
  'app/uninstalled',
] as const

// ── Formas crudas ────────────────────────────────────────────────────

/** Texto localizado: `{ es: "...", pt: "..." }` o ya un string plano. */
export type Localized = string | Record<string, string> | null | undefined

export interface TiendanubeStore {
  id?: number
  name?: Localized
  original_domain?: string
  domains?: string[]
  country?: string
  main_language?: string
  main_currency?: string
  email?: string
}

interface TiendanubeVariant {
  id?: number
  price?: string | number | null
  promotional_price?: string | number | null
  stock?: number | null
  sku?: string | null
}

interface TiendanubeImage {
  src?: string
}

interface TiendanubeProduct {
  id: number
  name?: Localized
  description?: Localized
  handle?: Localized
  published?: boolean
  brand?: string | null
  tags?: string | null
  variants?: TiendanubeVariant[]
  images?: TiendanubeImage[]
  canonical_url?: string
}

/**
 * Aplana un campo localizado. Prioriza el idioma principal de la tienda,
 * después los idiomas que efectivamente usa la región (es/pt/en) y, si
 * nada matchea, el primer valor no vacío — mejor un texto en otro idioma
 * que un producto sin título en el catálogo del agente.
 */
export function pickLocalized(value: Localized, mainLanguage?: string): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  const order = [mainLanguage, 'es', 'pt', 'en'].filter(Boolean) as string[]
  for (const lang of order) {
    const v = value[lang]
    if (typeof v === 'string' && v.trim()) return v
  }
  for (const v of Object.values(value)) {
    if (typeof v === 'string' && v.trim()) return v
  }
  return ''
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

/** El host público de la tienda: dominio propio si lo hay, si no el de la plataforma. */
export function tiendanubeStoreDomain(store: TiendanubeStore): string {
  const custom = (store.domains ?? []).find((d) => d && !d.includes('mitiendanube.'))
  return (custom || store.original_domain || '').replace(/^https?:\/\//, '').replace(/\/$/, '')
}

// ── Normalizadores ───────────────────────────────────────────────────

export function normalizeTiendanubeProduct(
  raw: unknown,
  ctx: { storeDomain: string; mainLanguage?: string },
): NormalizedProduct | null {
  const p = raw as TiendanubeProduct
  if (!p || typeof p.id !== 'number') return null

  const prices = (p.variants ?? [])
    // El precio efectivo es el promocional cuando existe: el agente debe
    // cotizar lo que el cliente realmente va a pagar, no el precio de lista.
    .map((v) => toNumber(v.promotional_price) ?? toNumber(v.price))
    .filter((n): n is number => n != null && n > 0)

  const handle = pickLocalized(p.handle, ctx.mainLanguage)
  const title = pickLocalized(p.name, ctx.mainLanguage)

  return {
    externalId: p.id,
    handle: handle || String(p.id),
    title: title || `#${p.id}`,
    description: stripHtml(pickLocalized(p.description, ctx.mainLanguage)),
    productType: null,
    vendor: p.brand ?? null,
    tags: String(p.tags ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    priceMin: prices.length ? Math.min(...prices) : null,
    priceMax: prices.length ? Math.max(...prices) : null,
    imageUrl: p.images?.[0]?.src ?? null,
    url:
      p.canonical_url ||
      (ctx.storeDomain && handle
        ? `https://${ctx.storeDomain}/productos/${handle}/`
        : null),
    raw: p as unknown as Record<string, unknown>,
  }
}

interface TiendanubeLineItem {
  name?: Localized
  quantity?: number
  price?: string | number
  variant_id?: number
  product_id?: number
  image?: { src?: string }
}

function normalizeLineItems(
  items: unknown,
  mainLanguage?: string,
): NormalizedLineItem[] {
  if (!Array.isArray(items)) return []
  return (items as TiendanubeLineItem[]).map((li) => ({
    title: pickLocalized(li.name, mainLanguage) || null,
    quantity: li.quantity ?? null,
    price: li.price != null ? String(li.price) : null,
    variantId: li.variant_id ?? null,
    productId: li.product_id ?? null,
    imageUrl: li.image?.src ?? null,
  }))
}

interface TiendanubeAddress {
  address?: string
  number?: string
  floor?: string
  city?: string
  province?: string
  zipcode?: string
  country?: string
  phone?: string
  name?: string
}

interface TiendanubeOrder {
  id: number
  number?: number | string
  contact_email?: string
  contact_phone?: string
  contact_name?: string
  customer?: {
    name?: string
    email?: string
    phone?: string
    total_spent?: string
    /** Tiendanube no expone orders_count; se deriva de este listado. */
    orders?: unknown[]
  }
  products?: unknown[]
  total?: string | number
  subtotal?: string | number
  discount?: string | number
  currency?: string
  payment_status?: string
  shipping_status?: string
  status?: string
  cancelled_at?: string | null
  paid_at?: string | null
  shipped_at?: string | null
  delivered_at?: string | null
  shipping_address?: TiendanubeAddress
  billing_address?: TiendanubeAddress
  shipping_tracking_number?: string | null
  shipping_tracking_url?: string | null
  shipping_option?: string | null
  cart_id?: number | string | null
  token?: string | null
  created_at?: string | null
}

/**
 * Traduce el vocabulario de estados de Tiendanube al de Riverz.
 *
 * Tiendanube separa pago (`payment_status`) de envío
 * (`shipping_status`) y agrega un `status` global que solo dice
 * open/closed/cancelled. Shopify mezcla todo en financial_status +
 * fulfillment_status, que es el par que consumen las automatizaciones y
 * los RPC de transición — así que traducimos hacia ESE vocabulario.
 */
function normalizeOrderState(o: TiendanubeOrder) {
  const payment = (o.payment_status ?? '').toLowerCase()
  const shipping = (o.shipping_status ?? '').toLowerCase()
  const cancelled = Boolean(o.cancelled_at) || (o.status ?? '').toLowerCase() === 'cancelled'

  let financialStatus: string | null = null
  if (payment === 'paid') financialStatus = 'paid'
  else if (payment === 'refunded') financialStatus = 'refunded'
  else if (payment === 'voided' || payment === 'abandoned') financialStatus = 'voided'
  else if (payment) financialStatus = 'pending'

  let fulfillmentStatus: string | null = null
  if (shipping === 'fulfilled' || shipping === 'shipped') fulfillmentStatus = 'fulfilled'
  else if (shipping === 'partially_fulfilled') fulfillmentStatus = 'partial'

  return {
    financialStatus,
    fulfillmentStatus,
    cancelled,
    delivered: Boolean(o.delivered_at) || shipping === 'delivered',
  }
}

function formatAddress(a: TiendanubeAddress | undefined) {
  if (!a) return { address: '', city: '', province: '', zip: '', country: '' }
  return {
    address: [a.address, a.number, a.floor].filter((p) => p && String(p).trim()).join(' '),
    city: a.city ?? '',
    province: a.province ?? '',
    zip: a.zipcode ?? '',
    country: a.country ?? '',
  }
}

export function normalizeTiendanubeOrder(
  raw: unknown,
  ctx: { mainLanguage?: string },
): NormalizedOrder | null {
  const o = raw as TiendanubeOrder
  if (!o || typeof o.id !== 'number') return null

  const shipping = o.shipping_address ?? o.billing_address
  const state = normalizeOrderState(o)

  return {
    externalId: o.id,
    name: `#${o.number ?? o.id}`,
    orderNumber: String(o.number ?? o.id),
    totalPrice: String(o.total ?? ''),
    subtotalPrice: String(o.subtotal ?? ''),
    totalDiscounts: String(o.discount ?? ''),
    currency: o.currency ?? '',
    lineItems: normalizeLineItems(o.products, ctx.mainLanguage),
    customer: {
      name: o.contact_name || o.customer?.name || shipping?.name || null,
      email: o.contact_email || o.customer?.email || null,
      phone: o.contact_phone || o.customer?.phone || shipping?.phone || null,
      countryCode: shipping?.country ?? null,
      // Tiendanube no manda un contador de pedidos en el pedido. Cuando
      // el cliente trae su historial embebido lo usamos; si no, 1 (este).
      ordersCount: Array.isArray(o.customer?.orders) ? o.customer!.orders!.length : 0,
    },
    shippingAddress: formatAddress(shipping),
    state,
    orderStatusUrl: '',
    // Tiendanube tiene su propio recurso de carritos abandonados (con su
    // `abandoned_checkout_url`), así que no derivamos nada desde el pedido.
    payUrl: '',
    trackingNumber: o.shipping_tracking_number ?? '',
    trackingCompany: o.shipping_option ?? '',
    trackingUrl: o.shipping_tracking_url ?? '',
    checkoutToken: o.cart_id != null ? String(o.cart_id) : (o.token ?? null),
    createdAt: o.created_at ?? null,
    raw: o as unknown as Record<string, unknown>,
  }
}

interface TiendanubeCheckout {
  id: number
  token?: string
  contact_email?: string
  contact_phone?: string
  contact_name?: string
  abandoned_checkout_url?: string
  total?: string | number
  currency?: string
  completed_at?: string | null
  products?: unknown[]
  created_at?: string
  shipping_address?: TiendanubeAddress
  billing_address?: TiendanubeAddress
}

export function normalizeTiendanubeCheckout(
  raw: unknown,
  ctx: { mainLanguage?: string },
): NormalizedCheckout | null {
  const c = raw as TiendanubeCheckout
  if (!c || c.id == null) return null
  const addr = c.shipping_address ?? c.billing_address
  return {
    // El id numérico es la clave estable; `token` cambia de forma entre
    // versiones de la API y no sirve como clave de upsert.
    checkoutId: String(c.id),
    customer: {
      name: c.contact_name || addr?.name || null,
      email: c.contact_email || null,
      phone: c.contact_phone || addr?.phone || null,
      countryCode: addr?.country ?? null,
      ordersCount: 0,
    },
    totalPrice: toNumber(c.total),
    currency: c.currency ?? null,
    lineItems: normalizeLineItems(c.products, ctx.mainLanguage),
    recoveryUrl: c.abandoned_checkout_url ?? null,
    completedAt: c.completed_at && c.completed_at !== '' ? c.completed_at : null,
    createdAt: c.created_at ?? null,
  }
}
