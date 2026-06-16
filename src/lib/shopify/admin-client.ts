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
      .eq('shop_domain', shopDomain)
      .neq('status', 'expired')
  } catch {
    /* swallow — best-effort */
  }
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

  async getShopInfo(): Promise<{ name: string; domain: string }> {
    const data = await this.rest<{ shop: { name: string; domain: string } }>(
      '/shop.json',
    )
    return { name: data.shop?.name ?? '', domain: data.shop?.domain ?? '' }
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
    const topics: { topic: string; path: string }[] = [
      { topic: 'checkouts/create', path: '/api/shopify/webhooks/checkouts' },
      { topic: 'checkouts/update', path: '/api/shopify/webhooks/checkouts' },
      { topic: 'orders/create', path: '/api/shopify/webhooks/orders' },
      { topic: 'orders/updated', path: '/api/shopify/webhooks/orders' },
      { topic: 'customers/update', path: '/api/shopify/webhooks/customers' },
      { topic: 'app/uninstalled', path: '/api/shopify/webhooks/app-uninstalled' },
    ]
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
}
