"use client";

import { useMemo, useState } from "react";
import { toShortId } from '@/lib/short-id';
import Link from "@/components/i18n/locale-link";
import { useT } from "@/hooks/use-locale";
import { useFormat } from "@/hooks/use-format";
import type { UserRow } from "@/lib/admin/queries";
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
import { SearchInput, RefreshButton } from "../_components/filters";

/** Todas las personas registradas en Riverz y dónde pertenecen. */
export default function AdminUsersPage() {
  const t = useT();
  const format = useFormat();
  const [search, setSearch] = useState("");

  const url = `/api/admin/users?limit=200&q=${encodeURIComponent(search)}`;
  const { data, loading, error, reload, live } =
    useAdminData<{ rows: UserRow[]; total: number }>(url);

  const columns = useMemo<Column<UserRow>[]>(
    () => [
      {
        key: "person",
        header: t("admin.colName"),
        cell: (r) => (
          <div>
            <p className="font-medium text-foreground">{r.full_name ?? "—"}</p>
            <Muted>{r.email ?? "—"}</Muted>
          </div>
        ),
      },
      {
        key: "workspaces",
        header: t("admin.colWorkspaces"),
        cell: (r) =>
          r.workspaces.length === 0 ? (
            <Muted>—</Muted>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {r.workspaces.map((w) => (
                <Link
                  key={w.id}
                  href={`/admin/comercios/${toShortId(w.id)}`}
                  className="rounded border border-border px-1.5 py-0.5 text-xs text-foreground transition-colors hover:border-primary/40"
                >
                  {w.name}
                  <span className="ml-1 text-muted-foreground">
                    {w.owner
                      ? t("admin.ownerBadge")
                      : w.role === "admin"
                        ? t("admin.roleAdmin")
                        : t("admin.roleAgent")}
                  </span>
                </Link>
              ))}
            </div>
          ),
      },
      {
        key: "locale",
        header: t("admin.colLocale"),
        cell: (r) => r.locale ?? "—",
      },
      {
        key: "terms",
        header: t("admin.colTerms"),
        cell: (r) =>
          r.terms_accepted_at ? (
            <span title={r.terms_version ?? undefined}>
              {format.date(r.terms_accepted_at)}
            </span>
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
        live={live}
        title={t("admin.usersTitle")}
        description={t("admin.sectionUsersDesc")}
        actions={
          <>
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder={t("admin.usersSearch")}
            />
            <RefreshButton onClick={reload} />
          </>
        }
      />

      <Panel>
        {loading ? (
          <Loading forma="table" />
        ) : error ? (
          <LoadError onRetry={reload} />
        ) : (
          <DataTable
            columns={columns}
            rows={data?.rows ?? []}
            rowKey={(r) => r.user_id}
          />
        )}
      </Panel>
    </div>
  );
}
