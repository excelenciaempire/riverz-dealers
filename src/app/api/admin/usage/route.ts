import { supabaseAdmin } from '@/lib/channels/admin-client';
import { adminGet, rangeFromSearch } from '@/lib/admin/route';
import { listUsage } from '@/lib/admin/queries';
import { leerCostoIa } from '@/lib/admin/costo-ia';

export const dynamic = 'force-dynamic';

/** Consumo y costo por comercio en un rango. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const { from, to } = rangeFromSearch(url);

  return adminGet(
    request,
    { action: 'view.usage', meta: { from: from.toISOString(), to: to.toISOString() } },
    async () => {
      const [rows, costo] = await Promise.all([
        listUsage(from, to),
        // El costo NO se estima acá. Sale de `billing_usage_daily`, que es la
        // única fuente que cuenta la caché —el 82% de lo que se paga— y que
        // tarifa con el modelo que de verdad contestó. Lo demás (mensajes,
        // llamadas, minutos, pedidos, tokens) sigue viniendo del RPC, que para
        // eso está bien: lo que perdió es la responsabilidad de decir cuánto
        // cuesta, que era donde mentía.
        leerCostoIa(supabaseAdmin(), { desde: from, hasta: to }),
      ]);
      const withCost = rows.map((r) => ({
        ...r,
        ai_cost_usd: costo.porCuenta.get(r.workspace_id)?.costoUsd ?? 0,
      }));
      return {
        rows: withCost,
        from: from.toISOString(),
        to: to.toISOString(),
        // El sello de frescura viaja con el número: si el acumulador se paró,
        // la pantalla lo dice en vez de presentar un costo incompleto como si
        // fuera el costo.
        costo: {
          medidoAt: costo.medidoAt,
          atrasoMin: costo.atrasoMin,
          confiable: costo.confiable,
        },
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
