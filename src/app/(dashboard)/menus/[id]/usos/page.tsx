"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  CircleCheck,
  CircleAlert,
  Clock,
  UserPlus,
  PlayCircle,
  PauseCircle,
  ChevronDown,
  ChevronRight,
  Search,
  Filter,
} from "lucide-react";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";

import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useT } from "@/hooks/use-locale";

/**
 * Vista de "Usos" de un menú: cuántas veces se ejecutó, cómo le fue
 * a cada cliente, dónde se trabó. Diseño minimalista — mismo lenguaje
 * que /campanas/[id]: métricas grandes arriba sin íconos coloridos,
 * sparkline neutro, tabla compacta abajo con búsqueda + filtro de
 * estado. Cuando el menú aún no tiene ejecuciones reales, mostramos un
 * empty-state.
 */

type RunStatus =
  | "active"
  | "completed"
  | "handed_off"
  | "timed_out"
  | "paused_by_agent"
  | "failed";

interface RunRow {
  id: string;
  status: RunStatus;
  current_node_key: string | null;
  started_at: string;
  last_advanced_at: string;
  ended_at: string | null;
  end_reason: string | null;
  vars: Record<string, unknown>;
  reprompt_count: number;
  contact: { id: string; name: string | null; phone: string } | null;
}

interface EventRow {
  flow_run_id: string;
  event_type: string;
  node_key: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

const STATUS_LABEL: Record<RunStatus, string> = {
  active: "flows.runStatusActive",
  completed: "flows.runStatusCompleted",
  handed_off: "flows.runStatusHandedOff",
  timed_out: "flows.runStatusTimedOut",
  paused_by_agent: "flows.runStatusPaused",
  failed: "flows.runStatusFailed",
};

const STATUS_TONE: Record<RunStatus, string> = {
  active:
    "border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  completed: "border-border bg-muted text-foreground",
  handed_off:
    "border-amber-600/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  timed_out: "border-border bg-muted/60 text-muted-foreground",
  paused_by_agent: "border-border bg-muted text-foreground",
  failed: "border-red-600/30 bg-red-500/10 text-red-600 dark:text-red-400",
};

const STATUS_ICON: Record<RunStatus, typeof Clock> = {
  active: PlayCircle,
  completed: CircleCheck,
  handed_off: UserPlus,
  timed_out: Clock,
  paused_by_agent: PauseCircle,
  failed: CircleAlert,
};

const RUN_STATUSES: readonly RunStatus[] = [
  "active",
  "completed",
  "handed_off",
  "timed_out",
  "paused_by_agent",
  "failed",
];

/**
 * Tarjeta de métrica: número tabular grande + etiqueta. Sin íconos ni
 * cajas de color — coincide con /campanas/[id].
 */
function MetricCard({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string | number;
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex-1 rounded-lg border bg-card p-4",
        emphasis ? "border-border" : "border-border/60",
      )}
    >
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
        {typeof value === "number" ? value.toLocaleString("es-ES") : value}
      </p>
    </div>
  );
}

/**
 * Sparkline simple: array de N puntos, dibuja un area + line. SVG puro,
 * sin librería. Color foreground/60 — muy neutro para no competir con
 * las cifras de arriba.
 */
function Sparkline({
  series,
  labels,
}: {
  series: number[];
  labels: string[];
}) {
  const t = useT();
  if (series.length === 0) return null;
  const max = Math.max(...series, 1);
  const W = 600;
  const H = 120;
  const stepX = W / Math.max(series.length - 1, 1);
  const points = series
    .map((v, i) => `${i * stepX},${H - (v / max) * (H - 20) - 10}`)
    .join(" ");
  const areaPath = `M 0,${H} L ${points.replace(/,/g, "/")
    .split(" ")
    .map((p) => p.replace("/", ","))
    .join(" L ")} L ${W},${H} Z`;
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-1 text-sm font-medium text-foreground">
        {t("flows.usagePerDay")}
      </h3>
      <p className="mb-3 text-xs text-muted-foreground">
        {t("flows.lastNDays", { n: series.length })}
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
          <span key={i} className={i % 2 === 1 ? "hidden sm:block" : undefined}>
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Distribución de estado: barras horizontales con cuenta + % del total.
 */
function StatusBreakdown({
  counts,
  total,
}: {
  counts: Record<RunStatus, number>;
  total: number;
}) {
  const t = useT();
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-1 text-sm font-medium text-foreground">
        {t("flows.howTheyEnded")}
      </h3>
      <p className="mb-3 text-xs text-muted-foreground">
        {t("flows.breakdownByStatus")}
      </p>
      <div className="space-y-1.5">
        {RUN_STATUSES.map((s) => {
          const n = counts[s] ?? 0;
          const pct = total > 0 ? Math.round((n / total) * 100) : 0;
          return (
            <div key={s} className="flex items-center gap-3">
              <span className="w-28 shrink-0 text-xs text-muted-foreground">
                {t(STATUS_LABEL[s])}
              </span>
              <div className="relative h-5 flex-1 rounded-md bg-muted/60">
                <div
                  className="h-5 rounded-md bg-foreground/70 transition-[width] duration-500"
                  style={{ width: `${Math.max(2, pct)}%` }}
                />
                <span className="absolute inset-0 flex items-center px-2 text-[11px] font-medium text-background mix-blend-screen tabular-nums">
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

export default function FlowRunsPage() {
  const router = useRouter();
  const t = useT();
  const params = useParams<{ id: string }>();

  const [flow, setFlow] = useState<{ id: string; name: string } | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [notFound, setNotFound] = useState(false);
  const [statusFilter, setStatusFilter] = useState<RunStatus | "all">("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!params.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/flows/${params.id}/runs`);
        if (res.status === 404) {
          if (!cancelled) setNotFound(true);
          return;
        }
        if (!res.ok) throw new Error(`Failed: ${res.status}`);
        const json = (await res.json()) as {
          flow: { id: string; name: string };
          runs: RunRow[];
          events: EventRow[];
        };
        if (!cancelled) {
          setFlow(json.flow);
          setRuns(json.runs ?? []);
          setEvents(json.events ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          toast.error(t("flows.runsLoadFailed"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  const sourceRuns = runs;
  const sourceEvents = events;

  // ── Métricas ──
  const counts = useMemo(() => {
    const c: Record<RunStatus, number> = {
      active: 0,
      completed: 0,
      handed_off: 0,
      timed_out: 0,
      paused_by_agent: 0,
      failed: 0,
    };
    for (const r of sourceRuns) c[r.status]++;
    return c;
  }, [sourceRuns]);

  const totalRuns = sourceRuns.length;
  const completedPct =
    totalRuns > 0 ? Math.round((counts.completed / totalRuns) * 100) : 0;

  // Duración promedio (sólo runs terminados).
  const avgDurationMs = useMemo(() => {
    const ended = sourceRuns.filter((r) => r.ended_at);
    if (ended.length === 0) return null;
    const sum = ended.reduce((acc, r) => {
      return (
        acc +
        (new Date(r.ended_at!).getTime() - new Date(r.started_at).getTime())
      );
    }, 0);
    return sum / ended.length;
  }, [sourceRuns]);

  // ── Serie temporal (últimos 14 días) ──
  const { series, sparkLabels } = useMemo(() => {
    const buckets: number[] = new Array(14).fill(0);
    const labels: string[] = [];
    const now = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      labels.push(format(d, "d/M"));
    }
    for (const r of sourceRuns) {
      const d = new Date(r.started_at);
      const diffDays = Math.floor(
        (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24),
      );
      const idx = 13 - diffDays;
      if (idx >= 0 && idx < 14) buckets[idx]++;
    }
    return { series: buckets, sparkLabels: labels };
  }, [sourceRuns]);

  // ── Filtros sobre la tabla ──
  const filteredRuns = useMemo(() => {
    let rows = sourceRuns;
    if (statusFilter !== "all") {
      rows = rows.filter((r) => r.status === statusFilter);
    }
    const q = query.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (r) =>
          (r.contact?.name ?? "").toLowerCase().includes(q) ||
          (r.contact?.phone ?? "").toLowerCase().includes(q),
      );
    }
    return rows;
  }, [sourceRuns, statusFilter, query]);

  function toggle(runId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (notFound || !flow) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">{t("flows.menuNotFound")}</p>
        <Button
          variant="outline"
          onClick={() => router.push("/menus")}
          className="text-sm"
        >
          {t("flows.back")}
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="icon"
          onClick={() => router.push(`/menus/${flow.id}`)}
          className="h-8 w-8 border-border"
          aria-label={t("flows.backToEditor")}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            {t("flows.menuLabel")} · <span className="text-foreground">{flow.name}</span>
          </p>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            {t("flows.usesTitle")}
          </h1>
        </div>
      </div>

      {runs.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card/40 px-6 py-16 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-accent-ink">
            <PlayCircle className="size-6" />
          </div>
          <h2 className="text-base font-medium text-foreground">
            {t("flows.emptyRunsTitle")}
          </h2>
          <p className="max-w-xs text-sm text-muted-foreground">
            {t("flows.emptyRunsDesc")}
          </p>
        </div>
      ) : (
        <>
          {/* Métricas top */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <MetricCard label={t("flows.metricTotalRuns")} value={totalRuns} emphasis />
        <MetricCard label={t("flows.metricActive")} value={counts.active} />
        <MetricCard label={t("flows.metricCompleted")} value={`${completedPct}%`} />
        <MetricCard label={t("flows.metricHandedOff")} value={counts.handed_off} />
        <MetricCard
          label={t("flows.metricAvgDuration")}
          value={
            avgDurationMs == null
              ? "—"
              : formatDurationShort(avgDurationMs)
          }
        />
      </div>

      {/* Gráficos */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Sparkline series={series} labels={sparkLabels} />
        <StatusBreakdown counts={counts} total={totalRuns} />
      </div>

      {/* Tabla de runs */}
      <div className="rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-medium text-foreground">
            {t("flows.conversations")}{" "}
            <span className="tabular-nums text-muted-foreground">
              ({filteredRuns.length}
              {statusFilter !== "all" || query
                ? t("flows.ofTotal", { total: sourceRuns.length })
                : ""}
              )
            </span>
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("flows.searchContact")}
                className="h-8 w-56 pl-8"
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 border-border bg-transparent text-foreground hover:bg-muted"
                  />
                }
              >
                <Filter className="size-3.5" />
                {statusFilter === "all"
                  ? t("flows.allStatuses")
                  : t(STATUS_LABEL[statusFilter])}
                <ChevronDown className="size-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="border-border bg-card">
                <DropdownMenuItem
                  onClick={() => setStatusFilter("all")}
                  className="text-foreground"
                >
                  {t("flows.allStatusesItem")}
                </DropdownMenuItem>
                {RUN_STATUSES.map((s) => (
                  <DropdownMenuItem
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className="text-foreground"
                  >
                    {t(STATUS_LABEL[s])}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {filteredRuns.length === 0 ? (
          <div className="flex h-32 items-center justify-center">
            <p className="text-sm text-muted-foreground">
              {t("flows.noResults")}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filteredRuns.map((run) => (
              <RunCard
                key={run.id}
                run={run}
                events={sourceEvents.filter((e) => e.flow_run_id === run.id)}
                expanded={expanded.has(run.id)}
                onToggle={() => toggle(run.id)}
              />
            ))}
          </div>
        )}
      </div>
        </>
      )}
    </div>
  );
}

function formatDurationShort(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  return `${(ms / 3_600_000).toFixed(1)} h`;
}

function RunCard({
  run,
  events,
  expanded,
  onToggle,
}: {
  run: RunRow;
  events: EventRow[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const StatusIcon = STATUS_ICON[run.status];
  const contactLabel =
    run.contact?.name?.trim() || run.contact?.phone || t("flows.unknownContact");
  const duration = run.ended_at
    ? formatDistanceToNow(new Date(run.started_at), {
        addSuffix: false,
      })
    : null;
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
      >
        {expanded ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {contactLabel}
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                STATUS_TONE[run.status],
              )}
            >
              <StatusIcon className="size-3" />
              {t(STATUS_LABEL[run.status])}
            </span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span>
              {format(new Date(run.started_at), "d MMM, HH:mm")}
            </span>
            {run.reprompt_count > 0 && (
              <span>{t("flows.retriesCount", { n: run.reprompt_count })}</span>
            )}
            {duration && <span>{t("flows.lastedFor", { duration })}</span>}
          </div>
        </div>
      </button>
      {expanded && (
        <div className="bg-muted/30 px-12 py-3">
          {Object.keys(run.vars).length > 0 && (
            <details className="mb-2">
              <summary className="cursor-pointer text-xs text-muted-foreground">
                {t("flows.capturedData", { n: Object.keys(run.vars).length })}
              </summary>
              <pre className="mt-2 overflow-x-auto rounded-md border border-border bg-card p-2 text-[11px] text-foreground">
                {JSON.stringify(run.vars, null, 2)}
              </pre>
            </details>
          )}
          <div className="flex flex-col gap-0.5">
            {events.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t("flows.noEventsLogged")}
              </p>
            ) : (
              events.map((ev, ix) => <EventLine key={ix} ev={ev} />)
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Eventos del runtime — antes mostraba "event_type" en inglés crudo
 * (node_entered, message_sent, fallback_fired). Traducidos a frases
 * legibles para que el merchant entienda qué pasó sin pelearse con
 * el log.
 */
const EVENT_HUMAN: Record<string, string> = {
  started: "flows.eventStarted",
  node_entered: "flows.eventNodeEntered",
  message_sent: "flows.eventMessageSent",
  reply_received: "flows.eventReplyReceived",
  fallback_fired: "flows.eventFallbackFired",
  handoff: "flows.eventHandoff",
  timeout: "flows.eventTimeout",
  error: "flows.eventError",
  completed: "flows.eventCompleted",
};

function EventLine({ ev }: { ev: EventRow }) {
  const t = useT();
  const human = EVENT_HUMAN[ev.event_type] ? t(EVENT_HUMAN[ev.event_type]) : ev.event_type;
  return (
    <div className="flex items-start gap-2 px-2 py-1 text-xs">
      <span className="w-16 shrink-0 text-[10px] tabular-nums text-muted-foreground">
        {format(new Date(ev.created_at), "HH:mm:ss")}
      </span>
      <span className="w-44 shrink-0 text-[11px] text-foreground">
        {human}
      </span>
      {ev.node_key && (
        <span className="shrink-0 rounded-md border border-border bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {ev.node_key}
        </span>
      )}
      {Object.keys(ev.payload).length > 0 && (
        <span className="min-w-0 truncate text-[10px] text-muted-foreground">
          {summarizePayload(ev.payload)}
        </span>
      )}
    </div>
  );
}

function summarizePayload(payload: Record<string, unknown>): string {
  const keys = ["reply_id", "captured_key", "reason", "advancing_to"];
  for (const k of keys) {
    if (k in payload && payload[k] !== null && payload[k] !== undefined) {
      return `${k}=${String(payload[k]).slice(0, 80)}`;
    }
  }
  return "";
}
