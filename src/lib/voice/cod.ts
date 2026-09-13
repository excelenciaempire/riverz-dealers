/**
 * Voice AI — COD (cash-on-delivery) write-back. OPT-IN, off for normal merchants.
 *
 * When a confirmation call resolves, optionally: (1) tag the Shopify order with
 * the outcome (Confirmado / Cancelado) so logistics can act, and (2) push the
 * confirmed order to Dropi for dispatch. Gated by the voice connection config
 * (`order_writeback.enabled`) and the presence of a Dropi connection. Fail-soft.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { VoiceCall, VoiceCallOutcome, VoiceConnectionConfig } from '@/types';
import { resolveShopifyAdmin, appendOrderTags } from '@/lib/shopify/order-tags';
import { pushOrderToDropi } from '@/lib/integrations/dropi';

function ctxStr(ctx: Record<string, unknown>, key: string): string {
  const v = ctx?.[key];
  return v == null ? '' : String(v);
}

/**
 * Best-effort COD write-back for a finished call. Never throws.
 */
export async function maybeCodWriteback(
  db: SupabaseClient,
  call: VoiceCall,
  outcome: VoiceCallOutcome,
): Promise<void> {
  // Data-review calls must never dispatch or tag an order as cancelled.
  if (call.context?.cod_writeback === false) return;
  try {
    const { data: connRow } = await db
      .from('channel_connections')
      .select('config')
      .eq('workspace_id', call.workspace_id)
      .eq('channel', 'voice')
      .maybeSingle();
    const cfg = (connRow as { config?: VoiceConnectionConfig } | null)?.config ?? {};
    const ctx = call.context ?? {};
    const orderId = ctxStr(ctx, 'order_id');

    // 1) Shopify order tag write-back.
    if (cfg.order_writeback?.enabled && orderId) {
      const confirmedTag = cfg.order_writeback.confirmed_tag || 'Confirmado';
      const cancelledTag = cfg.order_writeback.cancelled_tag || 'Cancelado';
      let tag: string | null = null;
      if (outcome === 'confirmed' || outcome === 'recovered') tag = confirmedTag;
      else if (outcome === 'cancelled_by_customer' || outcome === 'declined') tag = cancelledTag;
      if (tag) {
        const admin = await resolveShopifyAdmin(db, call.workspace_id);
        if (admin) await appendOrderTags(admin, orderId, [tag]);
      }
    }

    // 2) Dropi push on a confirmed order (only if Dropi is connected).
    if (outcome === 'confirmed' || outcome === 'recovered') {
      await pushOrderToDropi(db, call.workspace_id, {
        order_name: ctxStr(ctx, 'order_name') || ctxStr(ctx, 'order_number'),
        customer_name: ctxStr(ctx, 'customer_name'),
        phone: call.phone,
        address: ctxStr(ctx, 'shipping_address'),
        city: ctxStr(ctx, 'shipping_city'),
        province: ctxStr(ctx, 'shipping_province'),
        country: ctxStr(ctx, 'shipping_country'),
        total: ctxStr(ctx, 'total_price'),
        items: ctx.first_item,
      });
    }
  } catch (err) {
    console.error('[voice] COD write-back failed:', err);
  }
}
