/**
 * Legacy alias. The fail-OPEN duplicate that used to live here is gone —
 * this path now re-exports the CANONICAL, fail-CLOSED handler at
 * /api/shopify/webhooks/customers-redact, which HMAC-verifies and performs
 * the real contact anonymization.
 *
 * Prefer the canonical (non-/gdpr) URL in the Partner Dashboard.
 */
export { POST } from '../../customers-redact/route'
