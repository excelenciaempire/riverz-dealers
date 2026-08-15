"use client";

import { useMemo, useState } from "react";
import Link from "@/components/i18n/locale-link";
import { useT } from "@/hooks/use-locale";
import { useFormat } from "@/hooks/use-format";
import { cn } from "@/lib/utils";
import type { AuditRow, PlatformAuditRow } from "@/lib/admin/queries";
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
import { RefreshButton, SearchInput } from "../_components/filters";

type Source = "panel" | "agente";

/**
 * Qué se hizo sobre las cuentas, desde los dos lados.
 *
 * *Panel* es lo que miró y cambió el equipo desde /admin. *Agente* es lo que
 * hizo el servidor MCP sobre la cuenta de un comercio — lecturas incluidas,
 * porque sobre datos ajenos saber quién miró qué también es parte de la
 * respuesta. Esa segunda tabla se venía escribiendo desde el primer día y no la
 * leía ninguna pantalla.
 */
export default function AdminAuditPage() {
  const t = useT();
  const format = useFormat();
  const [source, setSource] = useState<Source>("panel");
  const [actor, setActor] = useState("");

  const url = `/api/admin/audit?limit=200&source=${source}&actor=${encodeURIComponent(actor)}`;
  const { data, loading, error, reload } = useAdminData<{
    rows: (AuditRow | PlatformAuditRow)[];
  }>(url);

  const panelColumns = useMemo<Column<AuditRow>[]>(
    () => [
      {
        key: "when",
        header: t("admin.colWhen"),
        cell: (r) => (
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {format.dateTime(r.created_at)}
          </span>
        ),
      },
      {
        key: "actor",
        header: t("admin.colActor"),
        cell: (r) => (
          <div>
            <p className="text-foreground">{r.actor_email}</p>
            <Muted>{r.ip ?? "—"}</Muted>
          </div>
        ),
      },
      {
        key: "action",
        header: t("admin.colAction"),
        cell: (r) => <code className="text-xs">{r.action}</code>,
      },
      {
        key: "target",
        header: t("admin.colTarget"),
        cell: (r) =>
          r.target_type ? (
            <span className="text-xs">
              {r.target_type}
              {r.target_id && (
                <span className="ml-1 text-muted-foreground">
                  {r.target_id.slice(0, 8)}
                </span>
              )}
            </span>
          ) : (
            <Muted>—</Muted>
          ),
      },
      {
        key: "meta",
        header: "",
        cell: (r) => {
          const entries = Object.entries(r.meta ?? {}).filter(
            ([, v]) => v !== null && v !== "",
          );
          if (!entries.length) return null;
          return (
            <div className="flex flex-wrap gap-x-3">
              {entries.map(([k, v]) => (
                <Muted key={k}>
                  {k}: {String(v)}
                </Muted>
              ))}
            </div>
          );
        },
      },
    ],
    [t, format],
  );

  const agentColumns = useMemo<Column<PlatformAuditRow>[]>(
    () => [
      {
        key: "when",
        header: t("admin.colWhen"),
        cell: (r) => (
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {format.dateTime(r.created_at)}
          </span>
        ),
      },
      {
        key: "actor",
        header: t("admin.colActor"),
        cell: (r) => <span className="text-foreground">{r.actor}</span>,
      },
      {
        key: "workspace",
        header: t("admin.colWorkspace"),
        cell: (r) =>
          r.workspace_id ? (
            <Link
              href={`/admin/comercios/${r.workspace_id}`}
              className="text-foreground underline-offset-2 hover:underline"
            >
              {r.workspace_name ?? r.workspace_id.slice(0, 8)}
            </Link>
          ) : (
            <Muted>—</Muted>
          ),
      },
      {
        key: "tool",
        header: t("admin.colTool"),
        cell: (r) => <code className="text-xs">{r.tool}</code>,
      },
      {
        key: "risk",
        header: t("admin.colRisk"),
        // Lo irreversible en ámbar aunque haya salido bien: es lo que le llegó
        // a una persona real y lo que uno vuelve a leer cuando algo pasó.
        cell: (r) => (
          <StatusPill
            tone={!r.ok ? "error" : r.risk === "irreversible" ? "warn" : "muted"}
            label={t(`admin.risk_${r.risk}`)}
          />
        ),
      },
      {
        key: "summary",
        header: t("admin.colSummary"),
        cell: (r) => <Clamp text={r.summary} />,
      },
    ],
    [t, format],
  );

  const tabs: { key: Source; label: string }[] = [
    { key: "panel", label: t("admin.auditSourcePanel") },
    { key: "agente", label: t("admin.auditSourceAgent") },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("admin.auditTitle")}
        description={t("admin.auditDesc")}
        actions={
          <>
            <SearchInput
              value={actor}
              onChange={setActor}
              placeholder={t("admin.filterActor")}
            />
            <RefreshButton onClick={reload} />
          </>
        }
      />

      <div className="flex flex-wrap gap-1.5">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setSource(tab.key)}
            className={cn(
              "h-8 rounded-md px-3 text-sm transition-colors",
              source === tab.key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <Panel>
        {loading ? (
          <Loading />
        ) : error ? (
          <LoadError onRetry={reload} />
        ) : source === "agente" ? (
          <DataTable
            columns={agentColumns}
            rows={(data?.rows ?? []) as PlatformAuditRow[]}
            rowKey={(r) => String(r.id)}
          />
        ) : (
          <DataTable
            columns={panelColumns}
            rows={(data?.rows ?? []) as AuditRow[]}
            rowKey={(r) => String(r.id)}
          />
        )}
      </Panel>
    </div>
  );
}
