'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';

interface AttrRow {
  id: string;
  name: string;
  orders_count: number;
  revenue: number;
  currency: string;
}

interface AttrResponse {
  by_broadcast: AttrRow[];
  by_flow: AttrRow[];
  by_automation: AttrRow[];
  by_instagram_agent: AttrRow[];
  totals?: {
    revenue: { current: number; previous: number };
    orders: { current: number; previous: number };
    currency: string;
  };
  not_connected?: boolean;
}

/**
 * Lo que generó Riverz, en plata.
 *
 * El cálculo ya existía completo en /api/analytics/attribution y no lo miraba
 * nadie: no tenía pantalla. Es el número que decide si el comercio sigue
 * pagando, así que vive en Inicio y no en un informe aparte.
 *
 * Las lentes se muestran SEPARADAS y sin total combinado a propósito. Un mismo
 * pedido puede caer en varias (la persona recibió la campaña Y pasó por la
 * automatización); sumarlas daría un número más lindo y mentiroso.
 *
 * La ventana de atribución es de 72 h y no de 24: una recuperación de pago
 * rechazado se cobra a los dos o tres días —la persona tiene que hablar con el
 * banco— y con 24 h esas ventas quedaban sin contar.
 */
export function AttributedRevenue({
  start,
  end,
}: {
  start: string | null;
  end: string | null;
}) {
  const t = useT();
  const fmt = useFormat();
  const [data, setData] = useState<AttrResponse | null>(null);

  useEffect(() => {
    if (!start || !end) return;
    let cancelled = false;
    void (async () => {
      try {
        const qs = new URLSearchParams({ start, end, attr_hours: '72' });
        const res = await fetch(`/api/analytics/attribution?${qs}`, {
          cache: 'no-store',
        });
        const json = (await res.json()) as AttrResponse;
        if (!cancelled && res.ok) setData(json);
      } catch {
        /* silencioso: es una tarjeta de más, no puede romper el panel */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [start, end]);

  // Sin tienda conectada no hay pedidos que atribuir: la tarjeta no aplica.
  if (!data || data.not_connected) return null;

  const lenses: Array<{ label: string; rows: AttrRow[] }> = [
    { label: t('health.revenueByAutomation'), rows: data.by_automation ?? [] },
    { label: t('health.revenueByBroadcast'), rows: data.by_broadcast ?? [] },
    { label: t('health.revenueByFlow'), rows: data.by_flow ?? [] },
    { label: t('health.revenueByIgAgent'), rows: data.by_instagram_agent ?? [] },
  ].filter((l) => l.rows.length > 0);

  const currency = data.totals?.currency;
  const storeRevenue = data.totals?.revenue.current ?? 0;
  if (lenses.length === 0 && storeRevenue === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          {t('health.revenueTitle')}
        </h2>
        <p className="text-xs text-muted-foreground">
          {t('health.revenueStoreTotal', {
            total: fmt.currency(storeRevenue, currency),
            orders: data.totals?.orders.current ?? 0,
          })}
        </p>
      </div>

      {lenses.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          {t('health.revenueNothingAttributed')}
        </p>
      ) : (
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {lenses.map((lens) => (
            <div key={lens.label}>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
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
      )}

      <p className="mt-3 text-[10px] leading-snug text-muted-foreground">
        {t('health.revenueDisclaimer')}
      </p>
    </div>
  );
}
