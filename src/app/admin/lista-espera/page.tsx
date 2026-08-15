"use client";

import { useMemo } from "react";
import { useT } from "@/hooks/use-locale";
import { useFormat } from "@/hooks/use-format";
import type { WaitlistRow } from "@/lib/admin/queries";
import {
  useAdminData,
  PageHeader,
  Panel,
  Loading,
  LoadError,
  DataTable,
  Muted,
  Stat,
  type Column,
} from "../_components/admin-ui";
import { RefreshButton } from "../_components/filters";

/**
 * Interesados del prelanzamiento. La tabla existe desde la migración 077 y
 * hasta ahora los leads solo se veían por el correo que dispara el formulario.
 */
export default function AdminWaitlistPage() {
  const t = useT();
  const format = useFormat();
  const { data, loading, error, reload, live } = useAdminData<{
    rows: WaitlistRow[];
    total: number;
  }>("/api/admin/waitlist?limit=300");

  const columns = useMemo<Column<WaitlistRow>[]>(
    () => [
      {
        key: "person",
        header: t("admin.colEmail"),
        cell: (r) => (
          <div>
            <p className="text-foreground">{r.email}</p>
            {r.name && <Muted>{r.name}</Muted>}
          </div>
        ),
      },
      {
        key: "source",
        header: t("admin.colSource"),
        cell: (r) => r.source ?? <Muted>—</Muted>,
      },
      {
        key: "created",
        header: t("admin.colCreated"),
        cell: (r) => format.dateTime(r.created_at),
      },
    ],
    [t, format],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        live={live}
        title={t("admin.waitlistTitle")}
        description={t("admin.sectionWaitlistDesc")}
        actions={<RefreshButton onClick={reload} />}
      />

      {data && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label={t("admin.totals")} value={format.number(data.total)} />
        </div>
      )}

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
          />
        )}
      </Panel>
    </div>
  );
}
