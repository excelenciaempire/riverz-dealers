"use client";

import { ChevronRight } from "lucide-react";
import Link from "@/components/i18n/locale-link";
import { useT } from "@/hooks/use-locale";
import { useFormat } from "@/hooks/use-format";
import type { PlatformOverview, ActivityPoint } from "@/lib/admin/queries";
import { ADMIN_SECTIONS, ADMIN_GROUPS } from "./sections";
import {
  useAdminData,
  PageHeader,
  Panel,
  Loading,
  LoadError,
  Stat,
} from "./_components/admin-ui";
import { RefreshButton, fromDays } from "./_components/filters";
import { Sparkline } from "./_components/sparkline";

interface Payload {
  overview: PlatformOverview | null;
  series: ActivityPoint[];
}

/**
 * Cómo va la plataforma entera, y el índice de secciones.
 *
 * El período está fijo en 30 días y no hay selector: esta pantalla contesta
 * "¿cómo venimos?" de un vistazo. Comparar rangos es el trabajo de Uso y
 * costos y de Registros, y ahí sí hay filtro.
 */
const PERIOD_DAYS = 30;

export default function AdminHomePage() {
  const t = useT();
  const format = useFormat();

  const url = `/api/admin/overview?from=${encodeURIComponent(fromDays(PERIOD_DAYS))}`;
  const { data, loading, error, reload } = useAdminData<Payload>(url);
  const o = data?.overview ?? null;
  const series = data?.series ?? [];

  const alerts: { n: number; label: string; href: string }[] = o
    ? [
        { n: o.connections_error, label: t("admin.alertConnections"), href: "/admin/canales" },
        { n: o.webhooks_unprocessed, label: t("admin.alertWebhooks"), href: "/admin/operacion" },
        { n: o.crons_error, label: t("admin.alertCrons"), href: "/admin/operacion" },
      ].filter((a) => a.n > 0)
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("admin.overviewTitle")}
        description={t("admin.overviewDesc")}
        actions={<RefreshButton onClick={reload} />}
      />

      {loading ? (
        <Loading />
      ) : error || !o ? (
        <LoadError onRetry={reload} />
      ) : (
        <>
          {/* Lo que requiere atención va primero: es a lo que se entra a mirar. */}
          <Panel title={t("admin.alertsTitle")}>
            {alerts.length === 0 ? (
              <p className="px-4 py-4 text-sm text-emerald-600 dark:text-emerald-400">
                {t("admin.allClear")}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {alerts.map((a) => (
                  <li key={a.href + a.label}>
                    <Link
                      href={a.href}
                      className="flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-muted/50"
                    >
                      <span className="font-semibold tabular-nums text-red-600 dark:text-red-400">
                        {format.number(a.n)}
                      </span>
                      <span className="flex-1 text-foreground">{a.label}</span>
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <Stat
              label={t("admin.kpiWorkspaces")}
              value={format.number(o.workspaces_active)}
              hint={`+${format.number(o.workspaces_new)} ${t("admin.kpiWorkspacesNew")}`}
            />
            <Stat label={t("admin.kpiUsers")} value={format.number(o.users_total)} />
            <Stat
              label={t("admin.kpiContacts")}
              value={format.number(o.contacts_total)}
            />
            <Stat
              label={t("admin.kpiConversations")}
              value={format.number(o.conversations_new)}
            />
            <Stat
              label={t("admin.kpiMessagesOut")}
              value={format.number(o.messages_out)}
            />
            <Stat
              label={t("admin.kpiMessagesFailed")}
              value={format.number(o.messages_failed)}
              tone={o.messages_failed > 0 ? "warn" : undefined}
            />
            <Stat label={t("admin.kpiAiSent")} value={format.number(o.ai_sent)} />
            <Stat
              label={t("admin.kpiCalls")}
              value={format.number(o.calls_total)}
              hint={`${format.number(Math.round(o.calls_minutes))} min · ${format.currency(o.calls_cost_usd, "USD")}`}
            />
          </div>

          {/* Small multiples: una serie por caja, sin ejes compartidos. */}
          <Panel title={t("admin.chartActivity")}>
            <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
              {(
                [
                  ["kpiMessagesIn", series.map((p) => p.messages_in)],
                  ["kpiMessagesOut", series.map((p) => p.messages_out)],
                  ["kpiAiSent", series.map((p) => p.ai_replies)],
                  ["kpiCalls", series.map((p) => p.calls)],
                ] as const
              ).map(([key, values]) => (
                <figure key={key} className="space-y-1">
                  <figcaption className="flex items-baseline justify-between">
                    <span className="text-xs text-muted-foreground">
                      {t(`admin.${key}`)}
                    </span>
                    <span className="text-sm font-medium tabular-nums text-foreground">
                      {format.number(values.reduce((a, b) => a + b, 0))}
                    </span>
                  </figcaption>
                  <Sparkline
                    values={values}
                    label={t(`admin.${key}`)}
                    className="h-9 w-full text-primary"
                  />
                </figure>
              ))}
            </div>
          </Panel>
        </>
      )}

      {/* Índice de secciones */}
      {ADMIN_GROUPS.map((g) => (
        <section key={g.key} className="space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t(g.label)}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ADMIN_SECTIONS.filter((s) => s.group === g.key).map((s) => (
              <Link
                key={s.href}
                href={s.href}
                className="group flex items-start gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
              >
                <s.icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{t(s.label)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t(s.description)}
                  </p>
                </div>
                <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
