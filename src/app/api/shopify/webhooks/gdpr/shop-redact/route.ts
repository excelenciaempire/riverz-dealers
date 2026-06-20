/**
 * Legacy alias. The fail-OPEN stub that used to live here (it acked 200
 * without verifying when SHOPIFY_API_SECRET was unset and did NOT wipe
 * anything) is gone — this path now re-exports the CANONICAL, fail-CLOSED
 * handler at /api/shopify/webhooks/shop-redact, which HMAC-verifies and
 * performs the real shop-scoped data wipe.
 *
 * Prefer the canonical (non-/gdpr) URL in the Partner Dashboard.
 */
export { POST } from '../../shop-redact/route'
