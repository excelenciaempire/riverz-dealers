// Alias route — the Shopify Partner Dashboard for "Riverz Inbox" was
// configured with /api/shopify/oauth/callback as the redirect URI, but
// the canonical handler lives at /api/shopify/callback. Re-exporting via
// `export { GET } from ...` was not picked up by Next.js' route detector,
// so we explicitly forward instead. The forwarder reconstructs the
// canonical URL preserving the original query string and delegates.
import { GET as canonicalGet } from '../../callback/route'

export async function GET(request: Request): Promise<Response> {
  const original = new URL(request.url)
  const canonical = new URL(
    '/api/shopify/callback' + original.search,
    original,
  )
  return canonicalGet(new Request(canonical, request))
}
