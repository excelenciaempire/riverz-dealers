import type { SupabaseClient } from '@supabase/supabase-js';

export type OrderAttributionSource =
  | 'campaign'
  | 'agent'
  | 'comment_to_dm'
  | 'ctwa';

/**
 * Record one order attributed to the Instagram engine into the unified ledger
 * (migration 094). Idempotent per (workspace, order) — a given order is
 * attributed once, first source wins. Best-effort; never throws.
 */
export async function recordOrderAttribution(
  db: SupabaseClient,
  row: {
    workspaceId: string;
    shopifyOrderId: string;
    orderName?: string | null;
    source: OrderAttributionSource;
    campaignId?: string | null;
    contactId?: string | null;
    channel?: string | null;
    code?: string | null;
    revenue?: number | null;
    currency?: string | null;
  },
): Promise<void> {
  await db
    .from('ig_order_attributions')
    .upsert(
      {
        workspace_id: row.workspaceId,
        shopify_order_id: row.shopifyOrderId,
        order_name: row.orderName ?? null,
        source: row.source,
        campaign_id: row.campaignId ?? null,
        contact_id: row.contactId ?? null,
        channel: row.channel ?? null,
        code: row.code ?? null,
        revenue: row.revenue ?? null,
        currency: row.currency ?? null,
      },
      { onConflict: 'workspace_id,shopify_order_id', ignoreDuplicates: true },
    )
    .then(
      () => {},
      () => {},
    );
}
