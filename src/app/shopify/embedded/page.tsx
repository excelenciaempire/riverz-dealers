import { headers } from 'next/headers'
import type { Metadata } from 'next'
import { EmbeddedClient } from './embedded-client'

/**
 * Embedded surface inside Shopify admin (App Store requirement: the app
 * must load in the admin iframe via App Bridge + session tokens).
 *
 * Riverz is a standalone platform — WhatsApp/IG/ML inbox, campaigns,
 * agents — so this page is deliberately minimal: it authenticates the
 * admin context with a session token, shows the connection state for
 * THIS shop, and hands off to riverz.co in a new tab. The proxy serves
 * it with `frame-ancestors https://<shop> https://admin.shopify.com`
 * (and skips the global X-Frame-Options DENY) so the iframe can render.
 *
 * The App Bridge script must be plain, synchronous and carry the CSP
 * nonce; it exposes `window.shopify.idToken()` which the client uses to
 * call /api/shopify/embedded/status.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Riverz' }

export default async function ShopifyEmbeddedPage({
  searchParams,
}: {
  searchParams: Promise<{ app?: string }>
}) {
  const nonce = (await headers()).get('x-nonce') ?? undefined
  const app = (await searchParams).app
  const apiKey =
    app === 'legacy'
      ? process.env.SHOPIFY_API_KEY_LEGACY ?? ''
      : process.env.SHOPIFY_API_KEY ?? ''
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-sync-scripts */}
      <script
        src="https://cdn.shopify.com/shopifycloud/app-bridge.js"
        data-api-key={apiKey}
        nonce={nonce}
      />
      <EmbeddedClient />
    </>
  )
}
