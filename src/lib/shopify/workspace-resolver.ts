/**
 * @deprecated — use `@/lib/workspaces/resolve` instead. This file
 * remains as a thin re-export so existing shopify callers don't break.
 * It used to live here because the only caller was the Shopify webhook
 * dispatcher; once WhatsApp + cron started needing the same logic, the
 * helper moved to a provider-agnostic location.
 */
export { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
