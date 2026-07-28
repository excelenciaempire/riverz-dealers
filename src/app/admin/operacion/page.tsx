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

type OpsPayload = OpsStatus & {
  schedules: CronSpec[];
  undeclared: CronSpec[];
};

/** Fila de la tabla: lo esperado (catálogo) cruzado con lo ocurrido (cron_runs). */
interface JobRow extends CronSpec {
  run: CronRow | null;
}

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
            <p className="font-medium text-foreground">{j.name}</p>
            <Muted>{j.what}</Muted>
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
        cell: (j) =>
          j.schedule ? (
            <code className="text-xs text-muted-foreground">{j.schedule}</code>
          ) : (
            <Muted>{t("admin.cronUndeclaredNote")}</Muted>
          ),
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

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("admin.opsTitle")}
        description={t("admin.sectionOpsDesc")}
        actions={<RefreshButton onClick={reload} />}
      />

      <div className="grid gap-3 sm:grid-cols-3">
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
          label={t("admin.cronUndeclared")}
          value={String(data.undeclared.length)}
          tone={data.undeclared.length > 0 ? "warn" : "ok"}
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
 * No declarado en render.yaml NO implica que no corra: hay trabajos que algo
 * externo al blueprint dispara igual. Si reportó corridas en las últimas 24 h
 * está vivo, y lo que hay que señalar es solo que el blueprint no lo refleja.
 */
function jobStatus(
  j: JobRow,
  t: (k: string) => string,
): { tone: Tone; label: string } {
  if (j.run?.status === "error")
    return { tone: "error", label: t("admin.statusError") };
  if (!j.schedule) {
    return j.run && j.run.runs_24h > 0
      ? { tone: "warn", label: t("admin.cronUndeclaredRunning") }
      : { tone: "warn", label: t("admin.cronUndeclared") };
  }
  if (isStale(j.schedule, j.run?.started_at ?? null))
    return { tone: "error", label: t("admin.cronStale") };
  return { tone: "ok", label: t("admin.infraStatusOk") };
}
