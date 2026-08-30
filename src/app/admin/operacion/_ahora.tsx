"use client";

import { useMemo } from "react";
import { ChevronRight } from "lucide-react";
import Link from "@/components/i18n/locale-link";
import { cn } from "@/lib/utils";
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
  /** Si late. Lo decide el servidor, que es el único que tiene el reloj. */
  alive: boolean;
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

export function Ahora() {
  const t = useT();
  const format = useFormat();
  const { data, loading, error, reload, live } =
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

  if (loading) return <Loading forma="table" />;
  if (error || !data) return <LoadError onRetry={reload} />;

  const broken = jobs.filter((j) => jobStatus(j, t).tone === "error").length;
  const beat = data.scheduler;
  // Lo decide el servidor: acá `Date.now()` sería una llamada impura en pleno
  // render, y además era la tercera copia de la misma regla.
  const beatOk = beat?.alive === true;

  return (
    <div className="space-y-5">
      <PageHeader
        live={live}
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

      {/* El contador, no la tabla.
          Las mismas filas se listaban acá y en el historial, con exactamente la
          misma consulta (`webhook_events_raw` con `processed_at IS NULL`). Dos
          tablas del mismo dato en la misma sección son dos lugares donde
          buscar y uno donde equivocarse: acá va el número —que es lo que se
          viene a ver— y el enlace lleva al historial, que además deja filtrar
          por fecha. */}
      <Panel title={t("admin.opsWebhooks")}>
        <Link
          href="?tab=historial&kind=webhooks"
          className="flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-muted/50"
        >
          <span
            className={cn(
              "font-semibold tabular-nums",
              data.webhooks.unprocessed > 0
                ? "text-amber-600 dark:text-amber-400"
                : "text-emerald-600 dark:text-emerald-400",
            )}
          >
            {data.webhooks.unprocessed}
          </span>
          <span className="flex-1 text-foreground">
            {t("admin.webhooksUnprocessed")}
          </span>
          <ChevronRight className="size-4 text-muted-foreground" />
        </Link>
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
