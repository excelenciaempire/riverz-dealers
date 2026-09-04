'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useLocalizedRouter } from '@/hooks/use-localized-router';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  ArrowLeft,
  Loader2,
  Edit,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Activity,
  ChevronDown,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { idColumn } from '@/lib/short-id';
import type { Automation, AutomationLog } from '@/types';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { RunJourney } from '@/components/automations/run-journey';
import { cn } from '@/lib/utils';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';

/**
 * Detail / visualizador de data de una automatización.
 *
 * Análogo a /campanas/[id] y /menus/[id]/usos: métricas grandes arriba,
 * sparkline de ejecuciones por día, breakdown por estado, tabla
 * compacta de los últimos runs con expand → step results. El editar / ver
 * todos los registros van a sus rutas dedicadas (/editar y /registros).
 */

type LogStatus = 'success' | 'partial' | 'failed';

// i18n key strings, resolved with t() at render time.
const STATUS_LABEL: Record<LogStatus, string> = {
  success: 'automations.runStatusCompleted',
  partial: 'automations.runStatusPartial',
  failed: 'automations.runStatusFailed',
};
const STATUS_TONE: Record<LogStatus, string> = {
  success:
    'border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  partial:
    'border-amber-600/25 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  failed: 'border-red-600/30 bg-red-500/10 text-red-700 dark:text-red-300',
};
const STATUS_ICON: Record<LogStatus, typeof Activity> = {
  success: CheckCircle2,
  partial: AlertCircle,
  failed: XCircle,
};

function MetricCard({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string | number;
  emphasis?: boolean;
}) {
  const fmt = useFormat();
  return (
    <div
      className={cn(
        'flex-1 rounded-lg border bg-card p-4',
        emphasis ? 'border-border' : 'border-border/60',
      )}
    >
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
        {typeof value === 'number' ? fmt.number(value) : value}
      </p>
    </div>
  );
}

function Sparkline({
  series,
  labels,
}: {
  series: number[];
  labels: string[];
}) {
  const t = useT();
  const max = Math.max(...series, 1);
  const W = 600;
  const H = 120;
  const stepX = W / Math.max(series.length - 1, 1);
  const points = series
    .map((v, i) => `${i * stepX},${H - (v / max) * (H - 20) - 10}`)
    .join(' ');
  const areaPath = `M 0,${H} L ${points.replace(/ /g, ' L ')} L ${W},${H} Z`;
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-1 text-sm font-medium text-foreground">
        {t("automations.runsPerDay")}
      </h3>
      <p className="mb-3 text-xs text-muted-foreground">
        {t("automations.lastNDays", { n: series.length })}
      </p>
      <svg
        viewBox={`0 0 ${W} ${H + 20}`}
        className="h-32 w-full"
        preserveAspectRatio="none"
      >
        <path d={areaPath} fill="currentColor" className="text-foreground/10" />
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
          className="text-foreground/60"
        />
      </svg>
      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-muted-foreground">
        {labels.map((l, i) => (
          <span key={i} className={i % 2 === 1 ? 'hidden sm:block' : undefined}>
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}

function StatusBreakdown({
  counts,
  total,
}: {
  counts: Record<LogStatus, number>;
  total: number;
}) {
  const t = useT();
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-medium text-foreground">
        {t("automations.howTheyEnded")}
      </h3>
      <div className="space-y-1.5">
        {(['success', 'partial', 'failed'] as LogStatus[]).map((s) => {
          const n = counts[s] ?? 0;
          const pct = total > 0 ? Math.round((n / total) * 100) : 0;
          return (
            <div key={s} className="flex items-center gap-3">
              <span className="w-24 shrink-0 text-xs text-muted-foreground">
                {t(STATUS_LABEL[s])}
              </span>
              <div className="relative h-5 flex-1 rounded-md bg-muted/60">
                <div
                  className="h-5 rounded-md bg-foreground/70 transition-[width] duration-500"
                  style={{ width: `${Math.max(2, pct)}%` }}
                />
                <span className="absolute inset-0 flex items-center px-2 text-[11px] font-medium tabular-nums text-background mix-blend-screen">
                  {n}
                </span>
              </div>
              <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
                {pct}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function AutomationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useLocalizedRouter();
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const automationId = params.id;

  const [automation, setAutomation] = useState<Automation | null>(null);
  const [logs, setLogs] = useState<AutomationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);
  const [openLogId, setOpenLogId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      if (!automationId) return;
      try {
        const supabase = createClient();
        // Primero la automatización, DESPUÉS sus registros — no en paralelo.
        // La URL que arma la lista trae el id corto (8 caracteres), y
        // `automation_logs.automation_id` es un uuid: buscarlo con el corto
        // reventaba la consulta entera ("invalid input syntax for type
        // uuid") y la pantalla mostraba "Error" para cualquier
        // automatización abierta desde la lista, tuviera corridas o no.
        // Sólo fallaba desde ahí, porque entrando con el uuid completo
        // ambas consultas eran válidas.
        const autRes = await supabase
          .from('automations')
          .select('*')
          .eq(idColumn(automationId), automationId)
          .maybeSingle();
        if (autRes.error) throw autRes.error;
        if (!autRes.data) {
          setError(t('automations.notFound'));
          return;
        }
        const automationRow = autRes.data as Automation;

        const logRes = await supabase
          .from('automation_logs')
          .select('*, contact:contacts(id, name, phone)')
          .eq('automation_id', automationRow.id)
          .order('created_at', { ascending: false })
          .limit(100);
        if (logRes.error) throw logRes.error;

        setAutomation(automationRow);
        setLogs((logRes.data ?? []) as AutomationLog[]);
      } catch (err) {
        setError(t('automations.genericError'));
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [automationId, t]);

  const counts = useMemo(() => {
    const c: Record<LogStatus, number> = { success: 0, partial: 0, failed: 0 };
    for (const l of logs) c[l.status as LogStatus]++;
    return c;
  }, [logs]);

  const total = logs.length;
  const successPct =
    total > 0 ? Math.round((counts.success / total) * 100) : 0;

  // Serie temporal últimos 14 días.
  const { series, sparkLabels } = useMemo(() => {
    const buckets = new Array<number>(14).fill(0);
    const labels: string[] = [];
    const now = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      labels.push(format(d, 'd/M'));
    }
    for (const l of logs) {
      const d = new Date(l.created_at);
      const diffDays = Math.floor(
        (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24),
      );
      const idx = 13 - diffDays;
      if (idx >= 0 && idx < 14) buckets[idx]++;
    }
    return { series: buckets, sparkLabels: labels };
  }, [logs]);

  async function handleToggle() {
    if (!automation) return;
    setToggling(true);
    try {
      const wantsEnabled = !(automation.is_active || automation.activation_state === 'armed');
      const res = await fetchWithCsrf(`/api/automations/${automation.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ is_active: wantsEnabled }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? 'update failed');
      const readiness = body?.readiness;
      setAutomation({
        ...automation,
        is_active: readiness ? readiness.is_active : false,
        activation_state: readiness ? readiness.activation_state : 'draft',
        activation_blockers: readiness ? readiness.activation_blockers : [],
      });
      toast.success(
        !wantsEnabled
          ? t('automations.automationPaused')
          : readiness?.activation_state === 'armed'
            ? t('automations.armedWaitingMeta')
            : t('automations.automationActivated'),
      );
    } catch (err) {
      toast.error(t('automations.updateFailed'));
    } finally {
      setToggling(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error || !automation) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-red-500">{error ?? t('automations.notFoundShort')}</p>
        <Button
          variant="outline"
          onClick={() => router.push('/automatizaciones')}
        >
          {t('automations.goBack')}
        </Button>
      </div>
    );
  }

  const lastRun = logs[0]?.created_at;
  const isArmed = automation.activation_state === 'armed';
  const blockers = automation.activation_blockers ?? [];
  const stateLabel = automation.is_active
    ? t('automations.active')
    : isArmed && blockers.some((b) => b.key === 'automations.issueMercadoPagoPendiente')
      ? t('automations.pendingMercadoPago')
      : isArmed && blockers.some((b) => b.key === 'automations.issuePlantillaNoAprobada')
        ? t('automations.pendingTemplate')
        : isArmed ? t('automations.armedWaitingMeta') : t('automations.paused');

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Button
            variant="outline"
            size="icon"
            onClick={() => router.push('/automatizaciones')}
            className="h-8 w-8 border-border"
            aria-label={t('automations.goBack')}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">
                {automation.name}
              </h1>
              <span
                className={cn(
                  'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
                  automation.is_active
                    ? 'border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'border-border bg-muted text-muted-foreground',
                )}
              >
                {stateLabel}
              </span>
            </div>
            {automation.description && (
              <p className="mt-0.5 text-sm text-muted-foreground">
                {automation.description}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Mismo control que la lista principal: un Switch, para que activar/
              pausar se vea y se entienda igual en los dos lugares. */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {stateLabel}
            </span>
            <Switch
              checked={automation.is_active || isArmed}
              onCheckedChange={handleToggle}
              disabled={toggling}
              aria-label={
                automation.is_active || isArmed
                  ? t('automations.deactivate')
                  : t('automations.activate')
              }
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/automatizaciones/${automation.id}/editar`)}
            className="h-8 border-border bg-transparent text-foreground hover:bg-muted"
          >
            <Edit className="size-3.5" />
            {t('automations.edit')}
          </Button>
        </div>
      </div>

      {/* Métricas top */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        <MetricCard
          label={t('automations.metricRuns')}
          value={automation.execution_count ?? logs.length}
          emphasis
        />
        <MetricCard label={t('automations.metricSuccess')} value={`${successPct}%`} />
        <MetricCard label={t('automations.metricPartial')} value={counts.partial} />
        <MetricCard label={t('automations.metricFailed')} value={counts.failed} />
        <MetricCard
          label={t('automations.metricLast')}
          value={lastRun ? format(new Date(lastRun), 'd MMM, HH:mm') : '—'}
        />
      </div>

      {/* Charts */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Sparkline series={series} labels={sparkLabels} />
        <StatusBreakdown counts={counts} total={total} />
      </div>

      {/* Recent runs */}
      <div className="rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-medium text-foreground">
            {t('automations.lastNRuns', { n: logs.length })}
          </h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              router.push(`/automatizaciones/${automation.id}/registros`)
            }
            className="h-8 border-border bg-transparent text-foreground hover:bg-muted"
          >
            {t('automations.viewAll')}
          </Button>
        </div>
        {logs.length === 0 ? (
          <div className="flex h-32 items-center justify-center">
            <p className="text-sm text-muted-foreground">
              {t('automations.notRunYet')}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {logs.slice(0, 20).map((log) => {
              const Icon = STATUS_ICON[log.status as LogStatus];
              const contactName =
                log.contact?.name?.trim() || log.contact?.phone || t('automations.system');
              const isOpen = openLogId === log.id;
              return (
                <li key={log.id}>
                  <button
                    type="button"
                    onClick={() => setOpenLogId(isOpen ? null : log.id)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/40"
                  >
                    <Icon
                      className={cn(
                        'size-3.5 shrink-0',
                        log.status === 'success'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : log.status === 'failed'
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-amber-600 dark:text-amber-400',
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm text-foreground">
                          {contactName}
                        </span>
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium',
                            STATUS_TONE[log.status as LogStatus],
                          )}
                        >
                          {t(STATUS_LABEL[log.status as LogStatus])}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {format(new Date(log.created_at), 'd MMM, HH:mm')}
                        {log.steps_executed?.length
                          ? ` · ${t('automations.stepsSuffix', { n: log.steps_executed.length })}`
                          : ''}
                      </p>
                    </div>
                    <ChevronDown
                      className={cn(
                        'size-4 shrink-0 text-muted-foreground transition-transform',
                        isOpen && 'rotate-180',
                      )}
                    />
                  </button>
                  {isOpen && (
                    <div className="border-t border-border bg-muted/20 px-4 py-3 pl-11">
                      <RunJourney log={log} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
