"use client";

import { useMemo, useState } from "react";
import { toShortId } from '@/lib/short-id';
import Link from "@/components/i18n/locale-link";
import { cn } from "@/lib/utils";
import { useT } from "@/hooks/use-locale";
import { useFormat } from "@/hooks/use-format";
import { LOG_KINDS, type LogEntry, type LogKind } from "@/lib/admin/log-kinds";
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
  type Column,
} from "../_components/admin-ui";
import { RangePicker, RefreshButton, fromDays } from "../_components/filters";

/**
 * Visor unificado de registros de toda la plataforma.
 *
 * Cada pestaña es una fuente distinta pero todas se ven igual: cuándo, qué
 * comercio, en qué estado quedó y por qué. Nunca se muestra el cuerpo de un
 * mensaje — solo el estado, el código y el motivo.
 */
const KIND_LABEL: Record<LogKind, string> = {
  ai: "admin.logKindAi",
  automations: "admin.logKindAutomations",
  flows: "admin.logKindFlows",
  messages: "admin.logKindMessages",
  webhooks: "admin.logKindWebhooks",
  comment_to_dm: "admin.logKindCommentToDm",
  ig_proactive: "admin.logKindIgProactive",
  voice: "admin.logKindVoice",
};

export default function AdminLogsPage() {
  const t = useT();
  const format = useFormat();
  const [kind, setKind] = useState<LogKind>("ai");
  const [days, setDays] = useState(7);

  const url = `/api/admin/logs?kind=${kind}&from=${encodeURIComponent(fromDays(days))}&limit=200`;
  const { data, loading, error, reload } =
    useAdminData<{ entries: LogEntry[] }>(url);

  const columns = useMemo<Column<LogEntry>[]>(
    () => [
      {
        key: "at",
        header: t("admin.colWhen"),
        cell: (e) => (
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {format.dateTime(e.at)}
          </span>
        ),
      },
      {
        key: "workspace",
        header: t("admin.workspace"),
        cell: (e) =>
          e.workspaceId ? (
            <Link
              href={`/admin/comercios/${toShortId(e.workspaceId)}`}
              className="text-foreground underline-offset-2 hover:underline"
            >
              {e.workspaceName ?? e.workspaceId.slice(0, 8)}
            </Link>
          ) : (
            <Muted>—</Muted>
          ),
      },
      {
        key: "status",
        header: t("admin.colStatus"),
        cell: (e) => <StatusPill tone={e.level} label={e.status ?? "—"} />,
      },
      {
        key: "detail",
        header: t("admin.colDetail"),
        cell: (e) => <Clamp text={e.detail} />,
      },
      {
        key: "extra",
        header: "",
        cell: (e) => (
          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            {Object.entries(e.extra)
              .filter(([, v]) => v !== null && v !== undefined && v !== "")
              .map(([k, v]) => (
                <Muted key={k}>
                  {k}: {String(v)}
                </Muted>
              ))}
          </div>
        ),
      },
    ],
    [t, format],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("admin.logsTitle")}
        description={kind === "ai" ? t("admin.logsAiHint") : t("admin.readOnlyNote")}
        actions={
          <>
            <RangePicker days={days} onChange={setDays} />
            <RefreshButton onClick={reload} />
          </>
        }
      />

      <nav className="flex flex-wrap gap-1">
        {LOG_KINDS.map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={cn(
              "rounded-md px-2.5 py-1.5 text-sm transition-colors",
              k === kind
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(KIND_LABEL[k])}
          </button>
        ))}
      </nav>

      <Panel>
        {loading ? (
          <Loading />
        ) : error ? (
          <LoadError onRetry={reload} />
        ) : (
          <DataTable
            columns={columns}
            rows={data?.entries ?? []}
            rowKey={(e) => e.id}
          />
        )}
      </Panel>
    </div>
  );
}
