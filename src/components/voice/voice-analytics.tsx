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
    <div className="bg-card p-3.5">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="text-foreground mt-1 text-xl font-semibold tracking-tight">
        {value}
      </p>
    </div>
  );
}

/** Compact voice-calls analytics panel for /metricas. Renders nothing until
 *  there's at least one call. Follows the dashboard date range when start/end
 *  are provided; otherwise falls back to the last 30 days. */
export function VoiceAnalytics({
  start,
  end,
  agentId,
  showEmpty = false,
}: {
  start?: string;
  end?: string;
  agentId?: string;
  showEmpty?: boolean;
} = {}) {
  const t = useT();
  const format = useFormat();
  const { workspace } = useWorkspace();
  const wsId = workspace?.id;
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!wsId) return;
    let cancelled = false;
    setLoading(true);
    setData(null);
    const range =
      start && end
        ? `start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
        : 'days=30';
    (async () => {
      try {
        const agent = agentId ? `&agent_id=${encodeURIComponent(agentId)}` : '';
        const res = await fetch(
          `/api/voice/analytics?workspace_id=${wsId}&${range}${agent}`,
          {
            cache: 'no-store',
          }
        );
        if (res.ok && !cancelled) setData((await res.json()) as Analytics);
      } catch {
        /* no-op */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wsId, start, end, agentId]);

  if (loading && showEmpty) {
    return (
      <div className="grid min-h-56 place-items-center">
        <span className="border-muted-foreground/30 border-t-foreground size-5 animate-spin rounded-full border-2" />
      </div>
    );
  }

  if (!data || data.total === 0) {
    return showEmpty ? (
      <div className="border-border bg-muted/20 grid min-h-56 place-items-center rounded-2xl border border-dashed text-center">
        <div>
          <PhoneCall className="text-muted-foreground mx-auto size-5" />
          <p className="text-foreground mt-2 text-sm font-medium">
            {t('voice.voiceAgentStatsEmpty')}
          </p>
        </div>
      </div>
    ) : null;
  }

  const maxHour = Math.max(1, ...data.by_hour.map((h) => h.count));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <PhoneCall className="h-4 w-4 text-yellow-500" />
        <h2 className="text-foreground text-sm font-semibold">
          {t('voice.metricsTitle')}
        </h2>
        {!(start && end) && (
          <span className="text-muted-foreground text-xs">
            ({t('voice.metricsLast30')})
          </span>
        )}
      </div>

      <div className="border-border bg-border grid grid-cols-2 gap-px overflow-hidden rounded-2xl border sm:grid-cols-3 lg:grid-cols-6">
        <Tile label={t('voice.metricTotal')} value={String(data.total)} />
        <Tile
          label={t('voice.metricAnswered')}
          value={`${data.answered_pct}%`}
        />
        <Tile
          label={t('voice.metricConfirmed')}
          value={`${data.confirmed_pct}%`}
        />
        <Tile label={t('voice.metricMinutes')} value={String(data.minutes)} />
        <Tile
          label={t('voice.metricCost')}
          value={data.cost > 0 ? `$${data.cost.toFixed(2)}` : '—'}
        />
        <Tile
          label={t('voice.metricUpsell')}
          value={
            data.upsell_revenue > 0 ? format.number(data.upsell_revenue) : '—'
          }
        />
      </div>

      {/* By hour — simple CSS bars */}
      <div className="border-border bg-card rounded-2xl border p-4 shadow-sm">
        <p className="text-muted-foreground mb-2 text-xs">
          {t('voice.metricByHour')}
        </p>
        <div className="flex h-20 items-end gap-0.5">
          {data.by_hour.map((h) => (
            <div
              key={h.hour}
              className="flex-1"
              title={`${h.hour}:00 — ${h.count}`}
            >
              <div
                className="bg-accent-ink/65 w-full rounded-t-sm transition-[height] duration-500"
                style={{ height: `${(h.count / maxHour) * 100}%` }}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* By city */}
        {data.by_city.length > 0 && (
          <div className="border-border bg-card rounded-2xl border p-4 shadow-sm">
            <p className="text-muted-foreground mb-2 text-xs">
              {t('voice.metricByCity')}
            </p>
            <div className="space-y-1">
              {data.by_city.map((c) => (
                <div
                  key={c.city}
                  className="flex items-center justify-between text-xs"
                >
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
        <div className="border-border bg-card rounded-2xl border p-4 shadow-sm">
          <p className="text-muted-foreground mb-2 text-xs">
            {t('voice.metricByOutcome')}
          </p>
          <div className="space-y-1">
            {data.by_outcome.map((o) => (
              <div
                key={o.outcome}
                className="flex items-center justify-between text-xs"
              >
                <span className="text-foreground">
                  {t(OUTCOME_KEY[o.outcome] ?? o.outcome)}
                </span>
                <span className="text-muted-foreground">{o.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
