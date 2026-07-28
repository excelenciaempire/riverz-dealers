'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';

interface AgentStatsData {
  activity: { sent: number; skipped: number; conversations: number };
  results: { calls: number; confirmed: number };
  cost: { tokens: number };
}

/**
 * Estadísticas por agente (Actividad · Resultados · Costo) para la pestaña
 * "Estadísticas" del editor. Datos de /api/ai/agents/[id]/stats (últimos 30 días).
 */
export function AgentStats({ agentId }: { agentId: string }) {
  const t = useT();
  const fmt = useFormat();
  const [data, setData] = useState<AgentStatsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/ai/agents/${agentId}/stats`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d && !d.error) setData(d as AgentStatsData);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!data) {
    return <p className="text-sm text-muted-foreground">{t('assistant.statsEmpty')}</p>;
  }

  const n = (v: number) => fmt.number(v);

  return (
    <div className="space-y-5">
      <p className="text-xs text-muted-foreground">{t('assistant.statsRange')}</p>

      <Group title={t('assistant.statsActivity')}>
        <Tile label={t('assistant.statsSent')} value={n(data.activity.sent)} />
        <Tile label={t('assistant.statsConversations')} value={n(data.activity.conversations)} />
        <Tile label={t('assistant.statsSkipped')} value={n(data.activity.skipped)} />
      </Group>

      <Group title={t('assistant.statsResults')}>
        <Tile label={t('assistant.statsCalls')} value={n(data.results.calls)} />
        <Tile label={t('assistant.statsConfirmed')} value={n(data.results.confirmed)} />
      </Group>

      <Group title={t('assistant.statsCost')}>
        <Tile label={t('assistant.statsTokens')} value={n(data.cost.tokens)} />
      </Group>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{children}</div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}
