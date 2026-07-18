/**
 * Cookie names for the Shopify pending-install claim flow. Isolated in a
 * dependency-free module so the client-side claim guard can import them
 * without dragging node:crypto / Supabase into the browser bundle.
 *
 *  - CLAIM_COOKIE (httpOnly): single-use claim token, server-only.
 *  - CLAIM_HINT_COOKIE (JS-readable): shop domain only, no secret — tells
 *    the dashboard to auto-claim after sign-in.
 */
export const CLAIM_COOKIE = 'shopify_claim'
export const CLAIM_HINT_COOKIE = 'shopify_claim_shop'
