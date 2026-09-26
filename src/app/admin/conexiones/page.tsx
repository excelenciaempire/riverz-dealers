"use client";

import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { toShortId } from '@/lib/short-id';
import Link from "@/components/i18n/locale-link";
import { useT } from "@/hooks/use-locale";
import { useFormat } from "@/hooks/use-format";
import type { ChannelRow } from "@/lib/admin/queries";
import { COEXISTENCE_ECHOES_MISSING } from "@/lib/channels/whatsapp/echo-health";
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

/**
 * Todo lo que un comercio puede tener conectado, en un solo lugar.
 *
 * Los primeros son canales de mensajería (`channel_connections`); los últimos
 * son tiendas (`shopify_connections`), medios de pago o marketing
 * (`workspace_integrations`) y la entrega contra reembolso
 * (`dropi_connections`). Viven en tablas distintas y por eso el panel mostraba
 * sólo los primeros — pero para el comercio, y para quien mira si algo se cayó,
 * es exactamente el mismo problema.
 *
 * La lista de tipos la arma el servidor a partir de los datos. Escrita a mano
 * acá se quedó atrás sin que nada fallara: le faltaba `webchat`.
 */

/** Salud de todas las conexiones de la plataforma. */
export default function AdminChannelsPage() {
  const t = useT();
  const format = useFormat();
  const [channel, setChannel] = useState("");
  const [status, setStatus] = useState("");

  const url = `/api/admin/channels?channel=${channel}&status=${status}`;
  const { data, loading, error, reload, live } = useAdminData<{
    rows: ChannelRow[];
    channels: string[];
    statuses: string[];
  }>(url);

  const rows = data?.rows ?? [];
  // Los tipos vienen de los datos, no de una lista escrita a mano acá: la que
  // había ya no incluía `webchat`, así que esas filas se veían pero no se
  // podían filtrar y nada fallaba para avisarlo.
  const channels = data?.channels ?? [];
  const statuses = data?.statuses ?? [];
  const broken = rows.filter(
    (r) => r.status === "error" || r.status === "expired",
  ).length;
  const connected = rows.filter((r) => CONECTADO.has(r.status)).length;

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
        cell: (r) => r.sync_history_unavailable ? (
          <Muted>{t('admin.syncLiveOnly')}</Muted>
        ) : (
          <div>
            {r.last_synced_at ? format.dateTime(r.last_synced_at) : <Muted>{t('admin.never')}</Muted>}
            {r.sync_pending && <div><StatusPill tone="warn" label={t('admin.syncPending')} /></div>}
          </div>
        ),
      },
      {
        key: "error",
        header: t("admin.lastError"),
        // Los códigos de salud propios se explican; los de Meta van tal cual.
        cell: (r) => (
          <Clamp
            text={
              r.last_error === COEXISTENCE_ECHOES_MISSING
                ? t("admin.errCoexistenceEchoesMissing")
                : r.last_error
            }
          />
        ),
      },
    ],
    [t, format],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        live={live}
        title={t("admin.sectionConnections")}
        description={t("admin.sectionConnectionsDesc")}
        actions={
          <>
            <Choice
              value={channel}
              onChange={setChannel}
              options={[
                { value: "", label: t("admin.all") },
                ...channels.map((c) => ({ value: c, label: c })),
              ]}
            />
            <Choice
              value={status}
              onChange={setStatus}
              options={[
                { value: "", label: t("admin.all") },
                ...statuses.map((s) => ({
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
          <Loading forma="filas" />
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

/**
 * Los dos vocabularios de estado.
 *
 * Los canales de mensajería dicen `connected`; las tiendas, `active`. Es la
 * misma cosa para quien mira esta pantalla, así que se pintan igual — y se
 * cuentan igual en el contador de arriba, que antes dejaba afuera a todas las
 * tiendas conectadas.
 */
const CONECTADO = new Set(["connected", "active"]);

function tone(status: string): Tone {
  if (CONECTADO.has(status)) return "ok";
  if (status === "error" || status === "expired") return "error";
  if (status === "pending") return "warn";
  return "muted";
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
