import { adminGet, rangeFromSearch } from '@/lib/admin/route';
import { listUsage } from '@/lib/admin/queries';
import { estimateAiCostUsd } from '@/lib/admin/cost';

export const dynamic = 'force-dynamic';

/** Consumo y costo por comercio en un rango. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const { from, to } = rangeFromSearch(url);

  return adminGet(
    request,
    { action: 'view.usage', meta: { from: from.toISOString(), to: to.toISOString() } },
    async () => {
      const rows = await listUsage(from, to);
      // El costo de IA no está en la DB: se estima aquí a partir de los tokens
      // que el runner viene guardando desde siempre, modelo por modelo.
      const withCost = rows.map((r) => ({
        ...r,
        ai_cost_usd: estimateAiCostUsd(
          r.prompt_tokens,
          r.completion_tokens,
          r.tokens_by_model,
        ),
      }));
      return {
        rows: withCost,
        from: from.toISOString(),
        to: to.toISOString(),
        totals: {
          messages_out: sum(withCost, 'messages_out'),
          ai_sent: sum(withCost, 'ai_sent'),
          prompt_tokens: sum(withCost, 'prompt_tokens'),
          completion_tokens: sum(withCost, 'completion_tokens'),
          ai_cost_usd: sum(withCost, 'ai_cost_usd'),
          calls: sum(withCost, 'calls'),
          call_minutes: sum(withCost, 'call_minutes'),
          call_cost_usd: sum(withCost, 'call_cost_usd'),
          orders: sum(withCost, 'orders'),
        },
      };
    },
  );
}

function sum<T extends Record<string, unknown>>(rows: T[], key: keyof T): number {
  return rows.reduce((acc, r) => acc + (Number(r[key]) || 0), 0);
}
