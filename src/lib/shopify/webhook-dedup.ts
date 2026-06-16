import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Per-(shop, webhook-id) dedupe for Shopify webhook receivers.
 *
 * Shopify's retry policy is up to 19 redeliveries spread over ~48h.
 * Without dedupe, an internal exception that happens AFTER a side
 * effect (state upsert, contact write, automation dispatch) but
 * BEFORE the 200 ack means every retry re-runs the side effect →
 * duplicate WhatsApp messages, double-counted orders, etc.
 *
 * Each delivery carries a unique `x-shopify-webhook-id` header.
 * We insert into `shopify_webhook_deliveries` keyed on
 * (shop_domain, webhook_id) and rely on the PK to reject duplicates
 * with 23505. Migration 059 installed the table.
 *
 * Fail open: if the dedupe INSERT itself fails (Supabase blip), we
 * proceed with dispatch rather than silently dropping the delivery.
 * The cost is a small risk of a duplicate; the alternative is a
 * lost notification.
 */
export async function isDuplicateDelivery(
  admin: SupabaseClient,
  shopDomain: string,
  webhookId: string | null,
  topic: string,
): Promise<boolean> {
  if (!webhookId) return false
  const { error } = await admin
    .from('shopify_webhook_deliveries')
    .insert({ shop_domain: shopDomain, webhook_id: webhookId, topic })
  if (error?.code === '23505') return true
  if (error) {
    console.warn(
      '[shopify] webhook dedup insert failed, proceeding:',
      error.message,
    )
  }
  return false
}
