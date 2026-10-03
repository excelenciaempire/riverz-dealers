'use client';
import { useState } from 'react';
import { useT, useLocale } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import type { DealerData } from '@/lib/dealers/types';
import { DEFAULT_DEALER_SETTINGS } from '@/lib/dealers/settings';
import { dealerGrowthMetrics } from '@/lib/dealers/growth';
export function DealerGrowthMetrics({ data }: { data: DealerData }) {
  const t = useT(),
    fmt = useFormat(),
    { locale } = useLocale(),
    settings = data.settings ?? DEFAULT_DEALER_SETTINGS,
    [days, setDays] = useState(settings.metrics.days),
    metrics = dealerGrowthMetrics(data, {
      ...settings,
      metrics: { ...settings.metrics, days },
    });
  const percent = (v: number | null) =>
    v === null ? '—' : `${fmt.number(v)}%`;
  return (
    <section className="space-y-6">
      <label className="flex items-center gap-3 text-sm">
        {t('dealers.cohortDays')}
        <select
          className="bg-background rounded-lg border p-2"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          {[...new Set([7, 30, 90, 365, settings.metrics.days])]
            .sort((a, b) => a - b)
            .map((d) => (
              <option key={d} value={d}>
                {t('dealers.lastDays', { days: d })}
              </option>
            ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'metricLeads', value: fmt.number(metrics.leads) },
          {
            label: 'metricResponse',
            value:
              metrics.medianResponseMinutes === null
                ? '—'
                : `${fmt.number(Math.round(metrics.medianResponseMinutes))} ${t('dealers.minutes')}`,
          },
          {
            label: 'metricContact',
            value: percent(metrics.contactRate),
            target: settings.metrics.target_contact_percent,
          },
          {
            label: 'metricShows',
            value: percent(metrics.showRate),
            target: settings.metrics.target_show_percent,
          },
          { label: 'metricBooked', value: fmt.number(metrics.booked) },
          { label: 'metricAttended', value: fmt.number(metrics.shows) },
          { label: 'metricWon', value: fmt.number(metrics.won) },
          {
            label: 'metricClose',
            value: percent(metrics.closeRate),
            target: settings.metrics.target_close_percent,
          },
        ].map((m) => (
          <article key={m.label} className="rounded-xl border p-4">
            <p className="text-muted-foreground text-xs">
              {t(`dealers.${m.label}`)}
            </p>
            <p className="mt-3 text-2xl font-medium tabular-nums">{m.value}</p>
            {m.target !== undefined && (
              <p className="text-muted-foreground mt-2 text-xs">
                {t('dealers.target', { percent: m.target })}
              </p>
            )}
          </article>
        ))}
      </div>
      <p className="text-muted-foreground text-xs">
        {t('dealers.metricDefinitions')}
      </p>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-left text-sm">
          <caption className="p-4 text-left font-medium">
            {t('dealers.sourcePerformance')}
          </caption>
          <thead>
            <tr>
              {[
                'lead_source',
                'metricLeads',
                'metricContact',
                'metricBooked',
                'metricShows',
                'metricWon',
                'metricClose',
              ].map((k) => (
                <th className="px-4 py-3 font-medium" key={k}>
                  {t(`dealers.${k}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metrics.sources.map((s) => (
              <tr key={s.source} className="border-t">
                <td className="px-4 py-3">{s.source}</td>
                {[
                  fmt.number(s.leads),
                  percent(s.contactRate),
                  fmt.number(s.booked),
                  percent(s.showRate),
                  fmt.number(s.won),
                  percent(s.closeRate),
                ].map((v, i) => (
                  <td key={i} className="px-4 py-3 tabular-nums">
                    {v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <section className="rounded-xl border p-5">
          <h2 className="font-medium">{t('dealers.reachedStages')}</h2>
          {metrics.stages.map((s) => (
            <div key={s.stage} className="mt-4 flex justify-between text-sm">
              <span>
                {settings.pipeline.labels[s.stage]?.[locale] ??
                  t(`dealers.${s.stage}`)}
              </span>
              <span>{fmt.number(s.count)}</span>
            </div>
          ))}
        </section>
        <section className="rounded-xl border p-5">
          <h2 className="font-medium">{t('dealers.lostReasons')}</h2>
          {metrics.losses.map((s) => (
            <div key={s.reason} className="mt-4 flex justify-between text-sm">
              <span>
                {settings.metrics.lost_reasons.includes(s.reason) &&
                [
                  'price',
                  'inventory',
                  'timing',
                  'financing',
                  'competitor',
                  'no_response',
                  'other',
                ].includes(s.reason)
                  ? t(`dealers.loss_${s.reason}`)
                  : s.reason}
              </span>
              <span>{fmt.number(s.count)}</span>
            </div>
          ))}
          {!metrics.losses.length && (
            <p className="text-muted-foreground mt-4 text-sm">
              {t('dealers.noLosses')}
            </p>
          )}
        </section>
      </div>
    </section>
  );
}
