/**
 * Legacy alias. The fail-OPEN duplicate that used to live here (it acked
 * 200 without verifying when SHOPIFY_API_SECRET was unset) is gone — this
 * path now re-exports the CANONICAL, fail-CLOSED handler at
 * /api/shopify/webhooks/customers-data-request so both URLs share one
 * HMAC-verified implementation.
 *
 * Prefer the canonical (non-/gdpr) URL in the Partner Dashboard.
 */
export { POST } from '../../customers-data-request/route'
