"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/hooks/use-locale";
import { useFormat } from "@/hooks/use-format";
import type { WorkspaceRow } from "@/lib/admin/queries";
import {
  useAdminData,
  PageHeader,
  Panel,
  Loading,
  LoadError,
  DataTable,
  StatusPill,
  Muted,
  type Column,
} from "../_components/admin-ui";
import { SearchInput, RefreshButton } from "../_components/filters";

/** Todos los comercios de la plataforma. Solo lectura. */
export default function AdminWorkspacesPage() {
  const t = useT();
  const format = useFormat();
  const router = useRouter();
  const [search, setSearch] = useState("");

  const url = `/api/admin/workspaces?limit=200&q=${encodeURIComponent(search)}`;
  const { data, loading, error, reload } =
    useAdminData<{ rows: WorkspaceRow[]; total: number }>(url);

  const columns = useMemo<Column<WorkspaceRow>[]>(
    () => [
      {
        key: "name",
        header: t("admin.workspace"),
        cell: (r) => (
          <div>
            <p className="font-medium text-foreground">{r.name}</p>
            {r.deleted_at && (
              <span className="text-xs text-red-600 dark:text-red-400">
                {t("admin.deletedBadge")}
              </span>
            )}
          </div>
        ),
      },
      {
        key: "owner",
        header: t("admin.colOwner"),
        cell: (r) => (
          <div>
            <p className="text-foreground">{r.owner_name ?? "—"}</p>
            <Muted>{r.owner_email ?? "—"}</Muted>
          </div>
        ),
      },
      {
        key: "channels",
        header: t("admin.colChannels"),
        cell: (r) =>
          r.connections_total === 0 ? (
            <Muted>—</Muted>
          ) : (
            <StatusPill
              tone={
                r.connections_broken > 0
                  ? "error"
                  : r.connections_connected > 0
                    ? "ok"
                    : "muted"
              }
              label={`${r.connections_connected}/${r.connections_total}`}
            />
          ),
      },
      {
        key: "members",
        header: t("admin.colMembers"),
        numeric: true,
        cell: (r) => format.number(r.members),
      },
      {
        key: "agents",
        header: t("admin.colAgents"),
        numeric: true,
        cell: (r) => `${r.agents_active}/${r.agents}`,
      },
      {
        key: "contacts",
        header: t("admin.colContacts"),
        numeric: true,
        cell: (r) => format.number(r.contacts),
      },
      {
        key: "activity",
        header: t("admin.colLastActivity"),
        cell: (r) =>
          r.last_activity_at ? (
            format.dateTime(r.last_activity_at)
          ) : (
            <Muted>{t("admin.never")}</Muted>
          ),
      },
      {
        key: "created",
        header: t("admin.colCreated"),
        cell: (r) => (r.created_at ? format.date(r.created_at) : "—"),
      },
    ],
    [t, format],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("admin.workspacesTitle")}
        description={t("admin.readOnlyNote")}
        actions={
          <>
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder={t("admin.workspacesSearch")}
            />
            <RefreshButton onClick={reload} />
          </>
        }
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
            rowKey={(r) => r.id}
            onRowClick={(r) => router.push(`/admin/comercios/${r.id}`)}
          />
        )}
      </Panel>
    </div>
  );
}
