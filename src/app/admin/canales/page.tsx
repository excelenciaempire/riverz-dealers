"use client";

import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { toShortId } from '@/lib/short-id';
import Link from "@/components/i18n/locale-link";
import { useT } from "@/hooks/use-locale";
import { useFormat } from "@/hooks/use-format";
import type { ChannelRow } from "@/lib/admin/queries";
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
import { Choice, RefreshButton } from "../_components/filters";

const CHANNELS = [
  "whatsapp",
  "instagram",
  "messenger",
  "gmail",
  "outlook",
  "fb_comment",
  "ig_comment",
  "mercadolibre",
  "tiktok_comment",
  "voice",
];

const STATUSES = ["connected", "disconnected", "error", "pending", "expired"];

/** Salud de todas las conexiones de canal de la plataforma. */
export default function AdminChannelsPage() {
  const t = useT();
  const format = useFormat();
  const [channel, setChannel] = useState("");
  const [status, setStatus] = useState("");

  const url = `/api/admin/channels?channel=${channel}&status=${status}`;
  const { data, loading, error, reload, live } =
    useAdminData<{ rows: ChannelRow[] }>(url);

  const rows = data?.rows ?? [];
  const broken = rows.filter(
    (r) => r.status === "error" || r.status === "expired",
  ).length;
  const connected = rows.filter((r) => r.status === "connected").length;

  const columns = useMemo<Column<ChannelRow>[]>(
    () => [
      {
        key: "channel",
        header: t("admin.colChannel"),
        cell: (r) => (
          <div>
            <p className="font-medium text-foreground">{r.channel}</p>
            {r.label && <Muted>{r.label}</Muted>}
          </div>
        ),
      },
      {
        key: "workspace",
        header: t("admin.workspace"),
        cell: (r) => (
          <Link
            href={`/admin/comercios/${toShortId(r.workspace_id)}`}
            className="text-foreground underline-offset-2 hover:underline"
          >
            {r.workspace_name ?? r.workspace_id.slice(0, 8)}
          </Link>
        ),
      },
      {
        key: "status",
        header: t("admin.colStatus"),
        cell: (r) => (
          <StatusPill
            tone={tone(r.status)}
            label={t(`admin.status${capitalize(r.status)}`)}
          />
        ),
      },
      {
        key: "account",
        header: t("admin.colAccount"),
        cell: (r) => <Clamp text={r.external_account_id} />,
      },
      {
        // La pregunta que más importa de un WhatsApp: ¿puede mandar?
        //
        // Estos tres campos ya venían en la respuesta —`listChannels` los pide
        // explícitamente— y la tabla no los mostraba: se pintaba la calidad,
        // que es otra cosa. Un WABA con `health_status = BLOCKED` (medio de
        // pago o datos fiscales pendientes en Meta) tiene calidad verde y no
        // entrega una sola plantilla.
        key: "cansend",
        header: t("admin.colCanSend"),
        cell: (r) => {
          if (r.channel !== "whatsapp") return <Muted>—</Muted>;
          if (r.health_status?.toUpperCase() === "BLOCKED") {
            return <StatusPill tone="error" label={t("admin.waBlocked")} />;
          }
          const can = r.health_can_send?.toUpperCase();
          if (can === "BLOCKED" || can === "LIMITED") {
            return (
              <StatusPill
                tone={can === "BLOCKED" ? "error" : "warn"}
                label={t(can === "BLOCKED" ? "admin.waBlocked" : "admin.waLimited")}
              />
            );
          }
          if (!can) return <Muted>—</Muted>;
          return <StatusPill tone="ok" label={t("admin.waCanSend")} />;
        },
      },
      {
        key: "quality",
        header: t("admin.qualityRating"),
        cell: (r) =>
          r.quality_rating ? (
            r.quality_rating
          ) : r.messaging_limit_tier ? (
            <Muted>{r.messaging_limit_tier}</Muted>
          ) : (
            <Muted>—</Muted>
          ),
      },
      {
        key: "sync",
        header: t("admin.lastSync"),
        cell: (r) =>
          r.last_synced_at ? (
            format.dateTime(r.last_synced_at)
          ) : (
            <Muted>{t("admin.never")}</Muted>
          ),
      },
      {
        key: "error",
        header: t("admin.lastError"),
        cell: (r) => <Clamp text={r.last_error} />,
      },
    ],
    [t, format],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        live={live}
        title={t("admin.channelsTitle")}
        description={t("admin.sectionChannelsDesc")}
        actions={
          <>
            <Choice
              value={channel}
              onChange={setChannel}
              options={[
                { value: "", label: t("admin.all") },
                ...CHANNELS.map((c) => ({ value: c, label: c })),
              ]}
            />
            <Choice
              value={status}
              onChange={setStatus}
              options={[
                { value: "", label: t("admin.all") },
                ...STATUSES.map((s) => ({
                  value: s,
                  label: t(`admin.status${capitalize(s)}`),
                })),
              ]}
            />
            <RefreshButton onClick={reload} />
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label={t("admin.statusConnected")} value={String(connected)} tone="ok" />
        <Stat
          label={t("admin.alertConnections")}
          value={String(broken)}
          tone={broken > 0 ? "error" : "ok"}
        />
        <Stat label={t("admin.totals")} value={String(rows.length)} />
      </div>

      <Panel>
        {loading ? (
          <Loading />
        ) : error ? (
          <LoadError onRetry={reload} />
        ) : (
          <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />
        )}
      </Panel>

      <Panel title={t("admin.resourcesTitle")}>
        <div className="px-4 pb-4">
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("admin.wooPluginDesc")}
          </p>
          <a
            href="/api/admin/woocommerce-plugin"
            className="mt-3 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
          >
            <Download className="size-3.5" />
            {t("admin.wooPluginDownload")}
          </a>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {t("admin.wooPluginNoSecret")}
          </p>
        </div>
      </Panel>
    </div>
  );
}

function tone(status: string): Tone {
  if (status === "connected") return "ok";
  if (status === "error" || status === "expired") return "error";
  if (status === "pending") return "warn";
  return "muted";
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
