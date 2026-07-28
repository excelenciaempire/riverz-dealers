"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/hooks/use-locale";
import { useFormat } from "@/hooks/use-format";
import type { UsageRow } from "@/lib/admin/queries";
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
import { RangePicker, RefreshButton, fromDays } from "../_components/filters";

type Row = UsageRow & { ai_cost_usd: number };

interface Payload {
  rows: Row[];
  totals: {
    messages_out: number;
    ai_sent: number;
    prompt_tokens: number;
    completion_tokens: number;
    ai_cost_usd: number;
    calls: number;
    call_minutes: number;
    call_cost_usd: number;
    orders: number;
  };
}

/** Cuánto consume y cuánto cuesta cada comercio. */
export default function AdminUsagePage() {
  const t = useT();
  const format = useFormat();
  const router = useRouter();
  const [days, setDays] = useState(30);

  const url = `/api/admin/usage?from=${encodeURIComponent(fromDays(days))}`;
  const { data, loading, error, reload } = useAdminData<Payload>(url);

  const columns = useMemo<Column<Row>[]>(
    () => [
      {
        key: "workspace",
        header: t("admin.workspace"),
        cell: (r) => (
          <div>
            <p className="font-medium text-foreground">{r.workspace_name}</p>
            <Muted>{r.owner_email ?? "—"}</Muted>
          </div>
        ),
      },
      {
        key: "out",
        header: t("admin.colMessagesOut"),
        numeric: true,
        cell: (r) => format.number(r.messages_out),
      },
      {
        key: "ai",
        header: t("admin.colAiSent"),
        numeric: true,
        cell: (r) => format.number(r.ai_sent),
      },
      {
        key: "tokens",
        header: t("admin.colTokens"),
        numeric: true,
        cell: (r) => format.number(r.prompt_tokens + r.completion_tokens),
      },
      {
        key: "aiCost",
        header: t("admin.colAiCost"),
        numeric: true,
        cell: (r) => format.currency(r.ai_cost_usd, "USD"),
      },
      {
        key: "calls",
        header: t("admin.colCalls"),
        numeric: true,
        cell: (r) => format.number(r.calls),
      },
      {
        key: "minutes",
        header: t("admin.colMinutes"),
        numeric: true,
        cell: (r) => format.number(Math.round(r.call_minutes)),
      },
      {
        key: "voiceCost",
        header: t("admin.colVoiceCost"),
        numeric: true,
        cell: (r) => format.currency(r.call_cost_usd, "USD"),
      },
      {
        key: "orders",
        header: t("admin.colOrders"),
        numeric: true,
        cell: (r) => format.number(r.orders),
      },
    ],
    [t, format],
  );

  const totals = data?.totals;

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("admin.usageTitle")}
        description={t("admin.usageDesc")}
        actions={
          <>
            <RangePicker days={days} onChange={setDays} />
            <RefreshButton onClick={reload} />
          </>
        }
      />

      {totals && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            label={t("admin.kpiAiCost")}
            value={format.currency(totals.ai_cost_usd, "USD")}
          />
          <Stat
            label={t("admin.kpiCallCost")}
            value={format.currency(totals.call_cost_usd, "USD")}
          />
          <Stat
            label={t("admin.kpiMessagesOut")}
            value={format.number(totals.messages_out)}
          />
          <Stat
            label={t("admin.kpiCallMinutes")}
            value={format.number(Math.round(totals.call_minutes))}
          />
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
            rowKey={(r) => r.workspace_id}
            onRowClick={(r) => router.push(`/admin/comercios/${r.workspace_id}`)}
          />
        )}
      </Panel>
    </div>
  );
}
