'use client';

import { useState } from 'react';
import {
  ShoppingBag,
  UserRound,
} from 'lucide-react';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import { MetricCard } from './metric-card';
import { DetalleAtribucion } from './detalle-atribucion';
import { Button } from '@/components/ui/button';
import type { OutcomeReport } from '@/lib/dashboard/outcomes';
import type { Atribucion } from '@/lib/dashboard/use-attribution';

export function OutcomesDashboard({
  data,
  error,
  attribution,
  onRefresh,
}: {
  data: OutcomeReport | null;
  error: boolean;
  attribution: Atribucion | null;
  onRefresh: () => void;
}) {
  const t = useT();
  const fmt = useFormat();
  const [salesOpen, setSalesOpen] = useState(false);
  const salesUnavailable =
    !attribution || !!attribution.error || attribution.not_connected;
  // Keep direct evidence and temporal association separate, with no inferred lift.
  const sales = attribution?.attributed;
  const pending = data?.pending ?? [];

  return (
    <section className="space-y-5" aria-label={t('dashboard.outcomeTitle')}>
      {data?.trial && (
        <div className="border-primary/25 bg-primary/5 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
          <div>
            <h2 className="font-semibold">{t('dashboard.outcomeTrial')}</h2>
            <p className="text-muted-foreground text-sm">
              {t('dashboard.outcomeTrialHelp')}
            </p>
          </div>
          {data.trial.until && (
            <span className="text-sm">
              {t('dashboard.outcomeTrialUntil', {
                date: fmt.date(data.trial.until),
              })}
            </span>
          )}
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-xl border p-4 text-sm"
        >
          {t('dashboard.outcomeLoadFailed')}
          <Button variant="outline" onClick={onRefresh}>
            {t('dashboard.outcomeRetry')}
          </Button>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <MetricCard
          title={t('dashboard.outcomePending')}
          value={data ? fmt.number(pending.length) : '—'}
          icon={UserRound}
          subtitle={t('dashboard.outcomePendingSub')}
        />
        <MetricCard
          title={t('dashboard.outcomeSales')}
          value={
            salesUnavailable
              ? '—'
              : fmt.money(
                  sales?.revenue ?? 0,
                  sales?.currency ?? attribution?.totals?.currency
                )
          }
          icon={ShoppingBag}
          subtitle={
            attribution?.not_connected
              ? t('dashboard.outcomeConnectStore')
              : attribution?.error === 'mixed_currencies'
                ? t('dashboard.outcomeMixedCurrencies')
                : salesUnavailable
                  ? t('dashboard.outcomeSalesUnavailable')
                  : t('dashboard.outcomeSalesSub', {
                      n: fmt.number(sales?.orders ?? 0),
                    })
          }
          onClick={!salesUnavailable ? () => setSalesOpen(true) : undefined}
        />
      </div>
      <DetalleAtribucion
        data={attribution}
        abierto={salesOpen}
        onAbierto={setSalesOpen}
      />
    </section>
  );
}
