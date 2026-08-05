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
export async function markShopifyConnectionExpired(
  shopDomain: string,
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
        last_error: 'Token revocado en Shopify — reconectar desde Ajustes',
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
export const SHOPIFY_WEBHOOK_TOPICS: ReadonlyArray<{ topic: string; path: string }> = [
  { topic: 'checkouts/create', path: '/api/shopify/webhooks/checkouts' },
  { topic: 'checkouts/update', path: '/api/shopify/webhooks/checkouts' },
  { topic: 'orders/create', path: '/api/shopify/webhooks/orders' },
  { topic: 'orders/updated', path: '/api/shopify/webhooks/orders' },
  { topic: 'customers/update', path: '/api/shopify/webhooks/customers' },
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
  ) {}

  private base(): string {
    return `https://${this.shop}/admin/api/${this.apiVersion}`
  }

  async rest<T = unknown>(
    path: string,
    init?: { method?: string; body?: unknown },
  ): Promise<T> {
    const res = await fetch(`${this.base()}${path}`, {
      method: init?.method ?? 'GET',
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
    const topics = SHOPIFY_WEBHOOK_TOPICS
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
    const ours = new Set(SHOPIFY_WEBHOOK_TOPICS.map((t) => t.path))
    const live = await this.listWebhooks()
    const base = callbackBaseUrl.replace(/\/+$/, '')

    let deleted = 0
    let kept = 0
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
        console.error(`[shopify] delete stale webhook ${w.topic} failed:`, err)
      }
    }

    let created = 0
    for (const { topic, path } of SHOPIFY_WEBHOOK_TOPICS) {
      if (present.has(`${topic}\n${path}`)) continue
      try {
        await this.rest('/webhooks.json', {
          method: 'POST',
          body: { webhook: { topic, address: `${base}${path}`, format: 'json' } },
        })
        created++
      } catch (err) {
        console.error(`[shopify] re-register webhook ${topic} failed:`, err)
      }
    }
    return { deleted, created, kept }
  }
}
