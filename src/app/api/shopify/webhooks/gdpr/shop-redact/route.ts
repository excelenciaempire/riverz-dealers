import { NextResponse } from 'next/server'
import { verifyWebhookHmac } from '@/lib/shopify/oauth'
import { getLogger } from '@/lib/log/logger'

const log = getLogger('shopify.gdpr.shop-redact')

/**
 * GDPR shop/redact. Fires 48h after the merchant uninstalls. Verify HMAC,
 * log, ack 200. The actual connection wipe happens on app/uninstalled +
 * the legacy /shop-redact route (still active); this stub satisfies the
 * partner dashboard endpoint requirement.
 */
export async function POST(request: Request) {
  const apiSecret = process.env.SHOPIFY_API_SECRET
  if (!apiSecret) return NextResponse.json({ ok: true })
  const rawBody = await request.text()
  if (
    !verifyWebhookHmac(
      rawBody,
      request.headers.get('x-shopify-hmac-sha256'),
      apiSecret,
    )
  ) {
    return new NextResponse('Invalid HMAC', { status: 401 })
  }
  log.info('received', {
    shop: request.headers.get('x-shopify-shop-domain') ?? null,
    bytes: rawBody.length,
  })
  return NextResponse.json({ ok: true })
}
