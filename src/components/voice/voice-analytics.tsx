'use client';

import { useEffect, useState } from 'react';
import { PhoneCall } from 'lucide-react';
import { useWorkspace } from '@/hooks/use-workspace';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';

interface Analytics {
  total: number;
  answered: number;
  answered_pct: number;
  confirmed: number;
  confirmed_pct: number;
  minutes: number;
  cost: number;
  upsell_revenue: number;
  by_hour: { hour: number; count: number }[];
  by_city: { city: string; total: number; confirmed: number }[];
  by_outcome: { outcome: string; count: number }[];
}

const OUTCOME_KEY: Record<string, string> = {
  confirmed: 'voice.outcomeConfirmed',
  cancelled_by_customer: 'voice.outcomeCancelled',
  rescheduled: 'voice.outcomeRescheduled',
  recovered: 'voice.outcomeRecovered',
  declined: 'voice.outcomeDeclined',
  callback_requested: 'voice.outcomeCallback',
  opt_out: 'voice.outcomeOptOut',
  no_outcome: 'voice.outcomeNone',
};

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

/** Compact voice-calls analytics panel for /metricas. Renders nothing until
 *  there's at least one call. Follows the dashboard date range when start/end
 *  are provided; otherwise falls back to the last 30 days. */
export function VoiceAnalytics({ start, end }: { start?: string; end?: string } = {}) {
  const t = useT();
  const format = useFormat();
  const { workspace } = useWorkspace();
  const wsId = workspace?.id;
  const [data, setData] = useState<Analytics | null>(null);

  useEffect(() => {
    if (!wsId) return;
    let cancelled = false;
    const range = start && end ? `start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}` : 'days=30';
    (async () => {
      try {
        const res = await fetch(`/api/voice/analytics?workspace_id=${wsId}&${range}`, {
          cache: 'no-store',
        });
        if (res.ok && !cancelled) setData((await res.json()) as Analytics);
      } catch {
        /* no-op */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wsId, start, end]);

  if (!data || data.total === 0) return null;

  const maxHour = Math.max(1, ...data.by_hour.map((h) => h.count));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <PhoneCall className="h-4 w-4 text-yellow-500" />
        <h2 className="text-sm font-semibold text-foreground">{t('voice.metricsTitle')}</h2>
        {!(start && end) && (
          <span className="text-xs text-muted-foreground">({t('voice.metricsLast30')})</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label={t('voice.metricTotal')} value={String(data.total)} />
        <Tile label={t('voice.metricAnswered')} value={`${data.answered_pct}%`} />
        <Tile label={t('voice.metricConfirmed')} value={`${data.confirmed_pct}%`} />
        <Tile label={t('voice.metricMinutes')} value={String(data.minutes)} />
        <Tile
          label={t('voice.metricCost')}
          value={data.cost > 0 ? `$${data.cost.toFixed(2)}` : '—'}
        />
        <Tile
          label={t('voice.metricUpsell')}
          value={data.upsell_revenue > 0 ? format.number(data.upsell_revenue) : '—'}
        />
      </div>

      {/* By hour — simple CSS bars */}
      <div className="rounded-lg border border-border bg-card p-3">
        <p className="mb-2 text-xs text-muted-foreground">{t('voice.metricByHour')}</p>
        <div className="flex h-20 items-end gap-0.5">
          {data.by_hour.map((h) => (
            <div key={h.hour} className="flex-1" title={`${h.hour}:00 — ${h.count}`}>
              <div
                className="w-full rounded-sm bg-yellow-500/60"
                style={{ height: `${(h.count / maxHour) * 100}%` }}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* By city */}
        {data.by_city.length > 0 && (
          <div className="rounded-lg border border-border bg-card p-3">
            <p className="mb-2 text-xs text-muted-foreground">{t('voice.metricByCity')}</p>
            <div className="space-y-1">
              {data.by_city.map((c) => (
                <div key={c.city} className="flex items-center justify-between text-xs">
                  <span className="text-foreground">{c.city}</span>
                  <span className="text-muted-foreground">
                    {c.confirmed}/{c.total}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* By outcome */}
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="mb-2 text-xs text-muted-foreground">{t('voice.metricByOutcome')}</p>
          <div className="space-y-1">
            {data.by_outcome.map((o) => (
              <div key={o.outcome} className="flex items-center justify-between text-xs">
                <span className="text-foreground">{t(OUTCOME_KEY[o.outcome] ?? o.outcome)}</span>
                <span className="text-muted-foreground">{o.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
