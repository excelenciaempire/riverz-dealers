'use client';

import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import type { AttrRow, Atribucion } from '@/lib/dashboard/use-attribution';

/**
 * De dónde salió esa plata.
 *
 * El total ya está arriba, en la tarjeta. Esto contesta la pregunta que sigue,
 * que es la accionable: CUÁL automatización, cuál campaña, cuál flujo. Sin
 * esto, "Riverz generó un millón" no dice qué repetir.
 *
 * Era cuatro listas en dos columnas —una por lente— con un encabezado cada una,
 * y en la práctica casi siempre hay UNA lente con UNA fila: media pantalla para
 * un renglón. Ahora es una sola lista ordenada por plata, con el tipo al lado
 * del nombre. Cuatro encabezados que casi nunca aparecen juntos no son
 * estructura, son ruido.
 *
 * El total va en la cabecera, al lado del título, para que se pueda comparar
 * con el desglose sin subir a las tarjetas. Las lentes NO se suman entre sí: un
 * mismo pedido puede caer en varias, así que la suma de los renglones puede
 * pasarse del total. El total cuenta pedidos, una vez cada uno.
 */
export function AttributedRevenue({ data }: { data: Atribucion | null }) {
  const t = useT();
  const fmt = useFormat();

  // Sin tienda conectada no hay pedidos que atribuir: la tarjeta no aplica.
  if (!data || data.not_connected) return null;

  const filas: Array<AttrRow & { tipo: string }> = [
    ...(data.by_automation ?? []).map((r) => ({ ...r, tipo: t('health.kindAutomation') })),
    ...(data.by_broadcast ?? []).map((r) => ({ ...r, tipo: t('health.kindBroadcast') })),
    ...(data.by_flow ?? []).map((r) => ({ ...r, tipo: t('health.kindFlow') })),
    ...(data.by_agent ?? []).map((r) => ({ ...r, tipo: t('health.kindAgent') })),
    ...(data.by_instagram_agent ?? []).map((r) => ({ ...r, tipo: t('health.kindIgAgent') })),
  ].sort((a, b) => b.revenue - a.revenue);

  // El total ya está en las tarjetas de arriba. Sin desglose esto no agrega
  // nada y no se muestra.
  if (filas.length === 0) return null;

  const total = data.attributed;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          {t('health.revenueTitle')}
        </h2>
        {total && total.orders > 0 && (
          <p className="text-xs text-muted-foreground">
            {t('health.revenueAttributedTotal', {
              total: fmt.currency(total.revenue, total.currency),
              orders: total.orders,
            })}
          </p>
        )}
      </div>

      <ul className="mt-3 divide-y divide-border/60">
        {filas.slice(0, 8).map((row) => (
          <li
            key={`${row.tipo}-${row.id}`}
            className="flex items-baseline justify-between gap-3 py-1.5 text-xs first:pt-0 last:pb-0"
          >
            <span className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className="truncate text-foreground">{row.name}</span>
              <span className="shrink-0 text-[10px] tracking-wide text-muted-foreground uppercase">
                {row.tipo}
              </span>
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

      <p className="mt-3 text-[10px] leading-snug text-muted-foreground">
        {t('health.revenueDisclaimer')}
      </p>
    </div>
  );
}
