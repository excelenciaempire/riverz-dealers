import type { SupabaseClient } from '@supabase/supabase-js';
export interface DealerQuoteEvidence {
  id: string;
  price: number;
  currency: string;
}
/** Evidence comes from server tool results, never from model-supplied prices. */
export function dealerQuoteEvidence(
  name: string,
  result: string
): DealerQuoteEvidence[] {
  if (name !== 'dealer_search_vehicles') return [];
  try {
    const data = JSON.parse(result);
    if (data.ok !== true || !Array.isArray(data.vehicles)) return [];
    return data.vehicles
      .slice(0, 12)
      .filter(
        (v: DealerQuoteEvidence) =>
          typeof v.id === 'string' &&
          /^[0-9a-f-]{36}$/i.test(v.id) &&
          typeof v.price === 'number' &&
          Number.isFinite(v.price) &&
          v.price >= 0 &&
          typeof v.currency === 'string' &&
          /^[A-Z]{3}$/.test(v.currency)
      )
      .map((v: DealerQuoteEvidence) => ({
        id: v.id,
        price: v.price,
        currency: v.currency,
      }));
  } catch {
    return [];
  }
}
/** Recheck availability and price before delivering a quote, including simulations. */
export async function verifiedDealerPrices(
  db: SupabaseClient,
  workspaceId: string,
  evidence: readonly DealerQuoteEvidence[]
): Promise<number[]> {
  if (!evidence.length) return [];
  const quotes = evidence.slice(0, 72);
  const { data, error } = await db
    .from('dealer_vehicles')
    .select('id,price,currency')
    .eq('workspace_id', workspaceId)
    .eq('status', 'available')
    .in('id', [...new Set(quotes.map((v) => v.id))]);
  if (error) throw new Error('price_integrity: dealer_inventory_unavailable');
  return (data ?? [])
    .filter((v) =>
      quotes.some(
        (q) =>
          q.id === v.id &&
          q.price === Number(v.price) &&
          q.currency === v.currency
      )
    )
    .map((v) => Number(v.price));
}
