import { refundMoney, refundMoneyText } from '@/lib/shopify/refund-plan';

export interface SummaryOrder {
  total_price: number | string | null;
  currency: string | null;
  financial_status: string | null;
  status: string | null;
}
const currencies = new Set(Intl.supportedValuesOf('currency'));

/** Stored order state, not a live provider check, cash ledger or net revenue. */
export function summarizeOrders(rows: SummaryOrder[]) {
  const byCurrency = new Map<string, { amount: bigint; orders: number }>();
  let paid = 0, excluded = 0, unavailable = 0;
  for (const row of rows) {
    if (row.financial_status !== 'paid' || !['created', 'paid', 'fulfilled'].includes(row.status ?? '')) {
      excluded++;
      continue;
    }
    paid++;
    const currency = row.currency?.trim().toUpperCase();
    // PostgREST may decode numeric as a JS number. Reject values whose scaled
    // representation cannot be kept safely; formatting cannot restore precision.
    const unsafe = typeof row.total_price === 'number' && !Number.isSafeInteger(Math.round(row.total_price * 1_000_000));
    const amount = unsafe ? null : refundMoney(row.total_price);
    if (!currency || !currencies.has(currency) || amount === null) {
      unavailable++;
      continue;
    }
    const group = byCurrency.get(currency) ?? { amount: BigInt(0), orders: 0 };
    group.amount += amount;
    group.orders++;
    byCurrency.set(currency, group);
  }
  const groups = [...byCurrency].sort(([a], [b]) => a.localeCompare(b)).map(([currency, group]) => ({
    moneda: currency, importe: refundMoneyText(group.amount), cantidad: group.orders,
  }));
  const single = groups.length === 1 && unavailable === 0 ? groups[0] : null;
  const numeric = single ? Number(single.importe) : null;
  // Retain the legacy scalar only when its round trip preserves the exact sum.
  const compatible = numeric !== null && Number.isSafeInteger(Math.round(numeric * 1_000_000)) && refundMoney(numeric) === refundMoney(single!.importe);
  return {
    cantidad: rows.length,
    pagados: paid,
    excluidos: excluded,
    importes_no_disponibles: unavailable,
    por_moneda: groups,
    facturado: compatible ? numeric : null,
    moneda: single?.moneda ?? null,
    criterio: 'stored_paid_order_totals_not_net_cash_or_live_provider',
  };
}
