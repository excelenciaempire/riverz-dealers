import type { SupabaseClient } from '@supabase/supabase-js';
import { confirmationSummary } from '@/lib/shopify/confirmation-summary';

export const RIVERZOFICIAL_WORKSPACE = '36f81b96-41b9-4d29-b72e-11be3d3070a3';

/** Only the merchant's product-personalized templates require this context.
 * Resolve old queued cart runs from their exact checkout, never contact.last_product.
 */
export async function requireRiverzoficialTemplateItems(
  db: SupabaseClient,
  workspaceId: string,
  templateName: string,
  vars: Record<string, unknown>,
) {
  if (workspaceId !== RIVERZOFICIAL_WORKSPACE || !/^deuna_(?:.*_producto|resumen_compra_(?:\d+|general))_v\d+$/.test(templateName)) return;
  if (vars.checkout_url) {
    const { data, error } = await db.from('shopify_checkouts').select('line_items')
      .eq('workspace_id', workspaceId).eq('abandoned_checkout_url', String(vars.checkout_url))
      .limit(1).maybeSingle();
    if (error) throw error;
    // Do not trust a stale item list when the current checkout is unavailable.
    vars.order_items = confirmationSummary({ line_items: data?.line_items }).order_items;
  }
  const items = String(vars.order_items ?? '').trim();
  if (!items || items === '—' || /(?:^|;\s*)\d+\s*×\s*—(?:\s*\(|;|$)/.test(items)) {
    throw new Error('Product-personalized template requires actual order or checkout items');
  }
}
