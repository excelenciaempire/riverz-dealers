"use client";

import { useMemo } from "react";
import { useT } from "@/hooks/use-locale";
import { useFormat } from "@/hooks/use-format";
import type { CronRow, OpsStatus } from "@/lib/admin/queries";
import { isStale, type CronSpec } from "@/lib/admin/crons";
import {
  useAdminData,
  PageHeader,
  Panel,
  Loading,
  LoadError,
  DataTable,
  StatusPill,
  Muted,
  Clamp,
  Stat,
  type Column,
  type Tone,
} from "../_components/admin-ui";
import { RefreshButton } from "../_components/filters";

/** Latido del reloj interno, tal como lo devuelve `schedulerStatus()`. */
interface SchedulerBeat {
  started: boolean;
  jobs: number;
  lastTickAt: string | null;
  running: string[];
}

type OpsPayload = OpsStatus & {
  schedules: CronSpec[];
  scheduler: SchedulerBeat;
};

/** Fila de la tabla: lo esperado (catálogo) cruzado con lo ocurrido (cron_runs). */
interface JobRow extends CronSpec {
  run: CronRow | null;
}

/**
 * El reloj despierta cada minuto. Dos minutos sin latir ya no es un retraso
 * normal: o el proceso se reinició o el reloj se murió, y con él TODO lo que
 * dispara — campañas, carritos, respuestas de la IA.
 */
const BEAT_STALE_MS = 2 * 60_000;

export default function AdminOpsPage() {
  const t = useT();
  const format = useFormat();
  const { data, loading, error, reload } =
    useAdminData<OpsPayload>("/api/admin/ops");

  const jobs = useMemo<JobRow[]>(() => {
    if (!data) return [];
    const runs = new Map(data.crons.map((c) => [c.name, c]));
    return data.schedules.map((s) => ({ ...s, run: runs.get(s.name) ?? null }));
  }, [data]);

  const columns = useMemo<Column<JobRow>[]>(
    () => [
      {
        key: "job",
        header: t("admin.colJob"),
        cell: (j) => (
          <div>
            <p className="font-medium text-foreground">
              {j.name}
              {j.parent && (
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  · {j.parent}
                </span>
              )}
            </p>
            <Muted>{t(j.whatKey)}</Muted>
          </div>
        ),
      },
      {
        key: "status",
        header: t("admin.colStatus"),
        cell: (j) => {
          const { tone, label } = jobStatus(j, t);
          return <StatusPill tone={tone} label={label} />;
        },
      },
      {
        key: "schedule",
        header: t("admin.colSchedule"),
        cell: (j) => <code className="text-xs text-muted-foreground">{j.schedule}</code>,
      },
      {
        key: "last",
        header: t("admin.colLastRun"),
        cell: (j) =>
          j.run?.started_at ? (
            format.dateTime(j.run.started_at)
          ) : (
            <Muted>{t("admin.never")}</Muted>
          ),
      },
      {
        key: "duration",
        header: t("admin.colDuration"),
        numeric: true,
        cell: (j) =>
          j.run?.duration_ms != null ? `${format.number(j.run.duration_ms)} ms` : "—",
      },
      {
        key: "runs",
        header: t("admin.colRuns24h"),
        numeric: true,
        cell: (j) =>
          j.run ? (
            <span className={j.run.errors_24h > 0 ? "text-red-600 dark:text-red-400" : ""}>
              {j.run.runs_24h - j.run.errors_24h}/{j.run.runs_24h}
            </span>
          ) : (
            "—"
          ),
      },
      {
        key: "error",
        header: t("admin.lastError"),
        cell: (j) => <Clamp text={j.run?.error} />,
      },
    ],
    [t, format],
  );

  const webhookColumns = useMemo<Column<OpsStatus["webhooks"]["failing"][number]>[]>(
    () => [
      {
        key: "when",
        header: t("admin.colWhen"),
        cell: (w) => (
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {format.dateTime(w.received_at)}
          </span>
        ),
      },
      { key: "provider", header: t("admin.colProvider"), cell: (w) => w.provider },
      {
        key: "attempts",
        header: t("admin.colAttempts"),
        numeric: true,
        cell: (w) => w.attempts,
      },
      {
        key: "error",
        header: t("admin.lastError"),
        cell: (w) => <Clamp text={w.last_error} />,
      },
    ],
    [t, format],
  );

  if (loading) return <Loading />;
  if (error || !data) return <LoadError onRetry={reload} />;

  const broken = jobs.filter((j) => jobStatus(j, t).tone === "error").length;
  const beat = data.scheduler;
  const beatAgeMs = beat?.lastTickAt ? Date.now() - Date.parse(beat.lastTickAt) : null;
  const beatOk = Boolean(beat?.started) && beatAgeMs !== null && beatAgeMs < BEAT_STALE_MS;

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("admin.opsTitle")}
        description={t("admin.sectionOpsDesc")}
        actions={<RefreshButton onClick={reload} />}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* El latido va PRIMERO: sin reloj, los otros números son de ayer. */}
        <Stat
          label={t("admin.schedulerBeat")}
          value={beatOk ? t("admin.schedulerAlive") : t("admin.schedulerDead")}
          hint={
            beat?.lastTickAt
              ? format.dateTime(beat.lastTickAt)
              : t("admin.never")
          }
          tone={beatOk ? "ok" : "error"}
        />
        <Stat
          label={t("admin.alertCrons")}
          value={String(broken)}
          tone={broken > 0 ? "error" : "ok"}
        />
        <Stat
          label={t("admin.alertWebhooks")}
          value={String(data.webhooks.unprocessed)}
          tone={data.webhooks.unprocessed > 0 ? "warn" : "ok"}
        />
        <Stat
          label={t("admin.schedulerRunning")}
          value={String(beat?.running?.length ?? 0)}
          hint={beat?.running?.join(", ") || undefined}
        />
      </div>

      <Panel title={t("admin.opsCrons")}>
        <DataTable columns={columns} rows={jobs} rowKey={(j) => j.name} />
      </Panel>

      <Panel
        title={`${t("admin.opsWebhooks")} · ${data.webhooks.unprocessed} ${t("admin.webhooksUnprocessed")}`}
      >
        <DataTable
          columns={webhookColumns}
          rows={data.webhooks.failing}
          rowKey={(w) => w.id}
        />
      </Panel>
    </div>
  );
}

/**
 * Estado de un trabajo cruzando el catálogo con lo que realmente ocurrió.
 *
 * Ya no existe "no declarado": hay un solo catálogo, y todo lo que está en él
 * lo dispara el reloj (o su padre, en el caso de los sub-trabajos). Un trabajo
 * sin corridas o con la última demasiado vieja está atrasado, y eso es rojo —
 * antes, tres trabajos con `schedule: null` en el catálogo viejo se libraban de
 * esta comprobación y no había forma de que se pintaran mal.
 */
function jobStatus(
  j: JobRow,
  t: (k: string) => string,
): { tone: Tone; label: string } {
  if (j.run?.status === "error")
    return { tone: "error", label: t("admin.statusError") };
  if (isStale(j.schedule, j.run?.started_at ?? null))
    return { tone: "error", label: t("admin.cronStale") };
  return { tone: "ok", label: t("admin.infraStatusOk") };
}
