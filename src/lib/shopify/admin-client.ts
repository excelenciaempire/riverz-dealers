/**
 * Minimal Shopify Admin API client (REST). Used to read shop metadata and
 * register webhooks right after OAuth. Ported/adapted from the Riverz
 * ShopifyAdminClient.
 */

import { shopifyApiVersion } from './oauth'
import { createClient } from '@supabase/supabase-js'

/** Typed error so callers can distinguish a credential failure from
 *  generic network errors. */
export class ShopifyUnauthorizedError extends Error {
  status = 401
  constructor(message: string) {
    super(message)
    this.name = 'ShopifyUnauthorizedError'
  }
}

/**
 * Fire-and-forget update flipping `shopify_connections.status` to
 * 'expired' so the Settings card shows a "Reconectar" CTA instead of a
 * green dot over a broken token. Shopify offline tokens don't expire
 * but can be revoked (merchant rotates API access, custom-app secret
 * rotation, store transfer) — without this, every order lookup
 * silently returns empty and the AI tells customers we have no record.
 */
/**
 * Shopify dejó de aceptar los tokens que no expiran.
 *
 * El mensaje llega con **403**, no con 401, así que caía en el `throw` genérico:
 * la conexión seguía figurando activa mientras TODAS sus llamadas fallaban.
 * Medido el 2026-08-24 sobre dos tiendas, una de ellas reconectada por OAuth
 * ese mismo minuto — o sea que reconectar tampoco lo arregla, porque el token
 * que emite este flujo es del tipo que Shopify ya no acepta.
 */
const TOKEN_DADO_DE_BAJA = /non-expiring access tokens are no longer accepted/i

export async function markShopifyConnectionExpired(
  shopDomain: string,
  motivo = 'Token revocado en Shopify — reconectar desde Ajustes',
): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return
  try {
    const admin = createClient(url, key)
    await admin
      .from('shopify_connections')
      .update({
        status: 'expired',
        last_error: motivo,
      })
      .eq('platform', 'shopify')
      .eq('shop_domain', shopDomain)
      .neq('status', 'expired')
  } catch {
    /* swallow — best-effort */
  }
}

/** Extract the `page_info` cursor for rel="next" out of a Shopify Link header. */
export function nextPageInfo(link: string | null): string | null {
  if (!link) return null
  for (const part of link.split(',')) {
    const m = part.match(/<[^>]*[?&]page_info=([^&>]+)[^>]*>\s*;\s*rel="next"/)
    if (m) return decodeURIComponent(m[1])
  }
  return null
}

/** Los webhooks que la tienda tiene que tener registrados hacia Riverz.
 *  Exportado porque además de registrarlos al conectar hay que RECONCILIARLOS:
 *  la dirección queda congelada en Shopify y, si el dominio del servicio cambia,
 *  la tienda sigue entregando pedidos y carritos a un servidor muerto. */
export const SHOPIFY_WEBHOOK_TOPICS: ReadonlyArray<{
  topic: string
  path: string
  scope?: string
}> = [
  { topic: 'app_subscriptions/update', path: '/api/shopify/webhooks/app-subscriptions' },
  { topic: 'checkouts/create', path: '/api/shopify/webhooks/checkouts', scope: 'read_checkouts' },
  { topic: 'checkouts/update', path: '/api/shopify/webhooks/checkouts', scope: 'read_checkouts' },
  // Borradores: la otra mitad de "Pedidos abandonados". Caen en la misma tabla
  // que los carritos y salen por la misma plantilla — ver la ruta.
  { topic: 'draft_orders/create', path: '/api/shopify/webhooks/draft-orders', scope: 'read_draft_orders' },
  { topic: 'draft_orders/update', path: '/api/shopify/webhooks/draft-orders', scope: 'read_draft_orders' },
  { topic: 'draft_orders/delete', path: '/api/shopify/webhooks/draft-orders', scope: 'read_draft_orders' },
  { topic: 'orders/create', path: '/api/shopify/webhooks/orders', scope: 'read_orders' },
  { topic: 'orders/updated', path: '/api/shopify/webhooks/orders', scope: 'read_orders' },
  { topic: 'customers/update', path: '/api/shopify/webhooks/customers', scope: 'read_customers' },
  // El precio que cotiza el agente tiene que cambiar al mismo tiempo que la
  // tienda, no la próxima vez que alguien pulse “Sincronizar”.
  { topic: 'products/create', path: '/api/shopify/webhooks/products', scope: 'read_products' },
  { topic: 'products/update', path: '/api/shopify/webhooks/products', scope: 'read_products' },
  { topic: 'products/delete', path: '/api/shopify/webhooks/products', scope: 'read_products' },
  { topic: 'app/uninstalled', path: '/api/shopify/webhooks/app-uninstalled' },
]

export interface ShopifyWebhook {
  id: number
  topic: string
  address: string
}

export class ShopifyAdminClient {
  constructor(
    private readonly shop: string,
    private readonly token: string,
    private readonly apiVersion: string = shopifyApiVersion(),
    private readonly timeoutMs?: number,
  ) {}

  private base(): string {
    return `https://${this.shop}/admin/api/${this.apiVersion}`
  }

  /** GraphQL Admin API call with the same credential handling as REST. */
  async graphql<T = unknown>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    const res = await fetch(`${this.base()}/graphql.json`, {
      method: 'POST',
      signal: this.timeoutMs ? AbortSignal.timeout(this.timeoutMs) : undefined,
      headers: {
        'X-Shopify-Access-Token': this.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    })
    const body = (await res.json().catch(() => null)) as {
      data?: T
      errors?: Array<{ message?: string }>
    } | null
    if (!res.ok || body?.errors?.length) {
      const message = body?.errors
        ?.map((error) => error.message)
        .filter(Boolean)
        .join('; ') || `HTTP ${res.status}`
      if (res.status === 401) {
        void markShopifyConnectionExpired(this.shop)
        throw new ShopifyUnauthorizedError(`Shopify Admin GraphQL: ${message}`)
      }
      throw new Error(`Shopify Admin GraphQL: ${message}`)
    }
    if (!body?.data) throw new Error('Shopify Admin GraphQL returned no data')
    return body.data
  }

  async rest<T = unknown>(
    path: string,
    init?: { method?: string; body?: unknown },
  ): Promise<T> {
    // AccessScope is the documented unversioned /admin/oauth resource,
    // not /admin/api/{version}/oauth (which returns a misleading 404).
    const url = path === '/oauth/access_scopes.json'
      ? `https://${this.shop}/admin${path}` : `${this.base()}${path}`
    const res = await fetch(url, {
      method: init?.method ?? 'GET',
      signal: this.timeoutMs ? AbortSignal.timeout(this.timeoutMs) : undefined,
      headers: {
        'X-Shopify-Access-Token': this.token,
        'Content-Type': 'application/json',
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      if (res.status === 401) {
        // Fire-and-forget — don't block the throw on the DB write.
        void markShopifyConnectionExpired(this.shop)
        throw new ShopifyUnauthorizedError(
          `Shopify Admin API 401: ${text.slice(0, 300)}`,
        )
      }
      // El 403 de los tokens dados de baja se trata como token muerto: la
      // conexión tiene que decir que no sirve en vez de seguir figurando activa
      // mientras cada llamada falla en silencio.
      if (res.status === 403 && TOKEN_DADO_DE_BAJA.test(text)) {
        void markShopifyConnectionExpired(
          this.shop,
          'Shopify dejó de aceptar el tipo de token de esta conexión. Reconectar no alcanza: hay que migrar la app a tokens que expiran.',
        )
        throw new ShopifyUnauthorizedError(
          `Shopify Admin API 403 (token dado de baja): ${text.slice(0, 300)}`,
        )
      }
      throw new Error(`Shopify Admin API ${res.status}: ${text.slice(0, 300)}`)
    }
    return res.json() as Promise<T>
  }

  /**
   * Like `rest` but also returns Shopify's `Link` header so callers can
   * cursor-paginate (REST `page_info` pagination). Used by the historical
   * backfill to walk ALL orders / abandoned checkouts since the store opened.
   */
  async restPaged<T = unknown>(
    path: string,
  ): Promise<{ data: T; link: string | null }> {
    const res = await fetch(`${this.base()}${path}`, {
      headers: {
        'X-Shopify-Access-Token': this.token,
        'Content-Type': 'application/json',
      },
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      if (res.status === 401) {
        void markShopifyConnectionExpired(this.shop)
        throw new ShopifyUnauthorizedError(
          `Shopify Admin API 401: ${text.slice(0, 300)}`,
        )
      }
      // El 403 de los tokens dados de baja se trata como token muerto: la
      // conexión tiene que decir que no sirve en vez de seguir figurando activa
      // mientras cada llamada falla en silencio.
      if (res.status === 403 && TOKEN_DADO_DE_BAJA.test(text)) {
        void markShopifyConnectionExpired(
          this.shop,
          'Shopify dejó de aceptar el tipo de token de esta conexión. Reconectar no alcanza: hay que migrar la app a tokens que expiran.',
        )
        throw new ShopifyUnauthorizedError(
          `Shopify Admin API 403 (token dado de baja): ${text.slice(0, 300)}`,
        )
      }
      throw new Error(`Shopify Admin API ${res.status}: ${text.slice(0, 300)}`)
    }
    return { data: (await res.json()) as T, link: res.headers.get('link') }
  }

  async getShopInfo(): Promise<{
    name: string
    domain: string
    /** ISO 4217 de la tienda (shop.currency). '' si Shopify no la devuelve. */
    currency: string
  }> {
    const data = await this.rest<{
      shop: { name: string; domain: string; currency?: string }
    }>('/shop.json')
    return {
      name: data.shop?.name ?? '',
      domain: data.shop?.domain ?? '',
      currency: data.shop?.currency ?? '',
    }
  }

  /**
   * Register the webhooks the abandoned-checkout + order automations need,
   * plus customers/update and app/uninstalled. Idempotent: Shopify dedupes
   * by (topic, address), so a 422 "address already taken" on reconnect is
   * swallowed. GDPR webhooks (customers/data_request, customers/redact,
   * shop/redact) are configured in the Partner dashboard, not here.
   *
   * Note: orders/fulfilled does NOT exist in the Shopify API — we subscribe
   * to orders/updated and diff fulfillment_status in the receiver to detect
   * the "just fulfilled" transition.
   */
  async registerWebhooks(callbackBaseUrl: string): Promise<void> {
    const topics = await this.availableWebhookTopics()
    for (const { topic, path } of topics) {
      try {
        await this.rest('/webhooks.json', {
          method: 'POST',
          body: {
            webhook: {
              topic,
              address: `${callbackBaseUrl}${path}`,
              format: 'json',
            },
          },
        })
      } catch (err) {
        // A 422 "address already taken" is expected on reconnect — log and
        // continue rather than failing the whole connect flow.
        console.error(`[shopify] register webhook ${topic} failed:`, err)
      }
    }
  }

  /** Los webhooks que la tienda tiene registrados hoy (de cualquier app). */
  async listWebhooks(): Promise<ShopifyWebhook[]> {
    const data = await this.rest<{ webhooks?: ShopifyWebhook[] }>(
      '/webhooks.json?limit=250',
    )
    return data.webhooks ?? []
  }

  async deleteWebhook(id: number): Promise<void> {
    await this.rest(`/webhooks/${id}.json`, { method: 'DELETE' })
  }

  /**
   * Shopify responde 422 "Invalid topic" cuando el token no tiene el scope
   * del tema. Las conexiones antiguas conservan exactamente los permisos que
   * aprobó el comercio; reconciliar no puede convertir esa diferencia normal
   * en una alarma cada quince minutos. Consultamos el token vivo y exigimos
   * sólo los webhooks que realmente puede recibir.
   */
  async availableWebhookTopics(): Promise<typeof SHOPIFY_WEBHOOK_TOPICS> {
    const data = await this.rest<{ access_scopes?: Array<{ handle?: string }> }>(
      '/oauth/access_scopes.json',
    )
    const granted = new Set(
      (data.access_scopes ?? []).map((scope) => scope.handle).filter(Boolean),
    )
    return SHOPIFY_WEBHOOK_TOPICS.filter((item) => !item.scope || granted.has(item.scope))
  }

  /**
   * Deja la tienda con EXACTAMENTE los webhooks de `SHOPIFY_WEBHOOK_TOPICS`
   * apuntando al dominio actual.
   *
   * `registerWebhooks` sólo agrega, y Shopify deduplica por (topic, address):
   * al cambiar de dominio quedan los nuevos conviviendo con los viejos, que
   * entregan a un servidor muerto para siempre. Acá se borran los que apuntan a
   * otro origen —sólo los de NUESTRAS rutas, para no tocar los webhooks de otra
   * aplicación instalada en la misma tienda— y se registra lo que falte.
   */
  async reconcileWebhooks(callbackBaseUrl: string): Promise<{
    deleted: number
    created: number
    kept: number
  }> {
    const topics = await this.availableWebhookTopics()
    const ours = new Set(SHOPIFY_WEBHOOK_TOPICS.map((t) => t.path))
    const live = await this.listWebhooks()
    const base = callbackBaseUrl.replace(/\/+$/, '')

    let deleted = 0
    let kept = 0
    const failures: string[] = []
    const present = new Set<string>()
    for (const w of live) {
      let path: string
      try {
        path = new URL(w.address).pathname
      } catch {
        continue
      }
      if (!ours.has(path)) continue // de otra app: no es nuestro para tocarlo
      if (w.address.startsWith(`${base}/`)) {
        present.add(`${w.topic}\n${path}`)
        kept++
        continue
      }
      try {
        await this.deleteWebhook(w.id)
        deleted++
      } catch (err) {
        if (err instanceof ShopifyUnauthorizedError) throw err
        failures.push(`delete ${w.topic}: ${err instanceof Error ? err.message : String(err)}`)
        console.error(`[shopify] delete stale webhook ${w.topic} failed:`, err)
      }
    }

    let created = 0
    for (const { topic, path } of topics) {
      if (present.has(`${topic}\n${path}`)) continue
      try {
        await this.rest('/webhooks.json', {
          method: 'POST',
          body: { webhook: { topic, address: `${base}${path}`, format: 'json' } },
        })
        created++
      } catch (err) {
        if (err instanceof ShopifyUnauthorizedError) throw err
        failures.push(`create ${topic}: ${err instanceof Error ? err.message : String(err)}`)
        console.error(`[shopify] re-register webhook ${topic} failed:`, err)
      }
    }
    if (failures.length) {
      throw new Error(`Shopify webhook reconciliation incomplete: ${failures.join('; ').slice(0, 1000)}`)
    }
    return { deleted, created, kept }
  }
}
