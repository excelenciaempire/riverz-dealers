/**
 * Minimal Shopify Admin API client (REST). Used to read shop metadata and
 * register webhooks right after OAuth. Ported/adapted from the Riverz
 * ShopifyAdminClient.
 */

import { shopifyApiVersion } from './oauth'

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
   * Register the webhooks the abandoned-checkout automation needs, plus
   * app/uninstalled. Idempotent-ish: Shopify dedupes by (topic, address),
   * so re-registering on reconnect is harmless. GDPR webhooks
   * (customers/redact etc.) are configured in the Partner dashboard, not
   * here — their receiver routes still exist and respond 200.
   */
  async registerWebhooks(callbackBaseUrl: string): Promise<void> {
    const topics: { topic: string; path: string }[] = [
      { topic: 'checkouts/create', path: '/api/shopify/webhooks/checkouts' },
      { topic: 'checkouts/update', path: '/api/shopify/webhooks/checkouts' },
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
