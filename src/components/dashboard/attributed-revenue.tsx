'use client';

import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import type { AttrRow, Atribucion } from '@/lib/dashboard/use-attribution';

/**
 * De dónde salió esa plata.
 *
 * El total ya está arriba, en las tarjetas. Esto contesta la pregunta que
 * sigue, que es la accionable: cuál automatización, cuál campaña, cuál flujo.
 *
 * Las lentes se muestran SEPARADAS y sin total combinado a propósito. Un mismo
 * pedido puede caer en varias (la persona recibió la campaña Y pasó por la
 * automatización); sumarlas daría un número más lindo y mentiroso. El total de
 * arriba sí es uno solo porque cuenta pedidos, no lentes.
 */
export function AttributedRevenue({ data }: { data: Atribucion | null }) {
  const t = useT();
  const fmt = useFormat();

  // Sin tienda conectada no hay pedidos que atribuir: la tarjeta no aplica.
  if (!data || data.not_connected) return null;

  const lenses: Array<{ label: string; rows: AttrRow[] }> = [
    { label: t('health.revenueByAutomation'), rows: data.by_automation ?? [] },
    { label: t('health.revenueByBroadcast'), rows: data.by_broadcast ?? [] },
    { label: t('health.revenueByFlow'), rows: data.by_flow ?? [] },
    { label: t('health.revenueByIgAgent'), rows: data.by_instagram_agent ?? [] },
  ].filter((l) => l.rows.length > 0);

  // El total ya está en las tarjetas de arriba. Si acá no hay desglose, esta
  // tarjeta no agrega nada y no se muestra.
  if (lenses.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h2 className="text-sm font-semibold text-foreground">
        {t('health.revenueTitle')}
      </h2>

      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        {lenses.map((lens) => (
          <div key={lens.label}>
            <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {lens.label}
            </p>
            <ul className="mt-1.5 space-y-1">
              {lens.rows.slice(0, 5).map((row) => (
                <li
                  key={row.id}
                  className="flex items-baseline justify-between gap-3 text-xs"
                >
                  <span className="min-w-0 flex-1 truncate text-foreground">
                    {row.name}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {row.orders_count} ·{' '}
                    <span className="font-medium text-foreground">
                      {fmt.currency(row.revenue, row.currency)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <p className="mt-3 text-[10px] leading-snug text-muted-foreground">
        {t('health.revenueDisclaimer')}
      </p>
    </div>
  );
}
