"use client";

import { useMemo } from "react";
import { useT } from "@/hooks/use-locale";
import { useFormat } from "@/hooks/use-format";
import type { AuditRow } from "@/lib/admin/queries";
import {
  useAdminData,
  PageHeader,
  Panel,
  Loading,
  LoadError,
  DataTable,
  Muted,
  type Column,
} from "../_components/admin-ui";
import { RefreshButton } from "../_components/filters";

/** Qué miró y qué cambió cada miembro del equipo. */
export default function AdminAuditPage() {
  const t = useT();
  const format = useFormat();
  const { data, loading, error, reload } = useAdminData<{ rows: AuditRow[] }>(
    "/api/admin/audit?limit=200",
  );

  const columns = useMemo<Column<AuditRow>[]>(
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

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("admin.auditTitle")}
        description={t("admin.auditDesc")}
        actions={<RefreshButton onClick={reload} />}
      />
      <Panel>
        {loading ? (
          <Loading />
        ) : error ? (
          <LoadError onRetry={reload} />
        ) : (
          <DataTable
            columns={columns}
            rows={data?.rows ?? []}
            rowKey={(r) => String(r.id)}
          />
        )}
      </Panel>
    </div>
  );
}
