import type { SupabaseClient } from '@supabase/supabase-js';

/** Dealer prices follow the vehicle inventory, never an inherited checkout default. */
export async function dealerInventoryCurrency(
  db: SupabaseClient,
  workspaceId: string
): Promise<string | null> {
  const counts = new Map<string, number>();
  try {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await db
        .from('dealer_vehicles')
        .select('currency')
        .eq('workspace_id', workspaceId)
        .eq('status', 'available')
        .order('id')
        .range(offset, offset + 999);
      if (error) return null;
      for (const row of data ?? []) {
        const currency =
          typeof row.currency === 'string' ? row.currency.toUpperCase() : '';
        if (/^[A-Z]{3}$/.test(currency))
          counts.set(currency, (counts.get(currency) ?? 0) + 1);
      }
      if (!data || data.length < 1000) break;
    }
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  } catch {
    return null;
  }
}
