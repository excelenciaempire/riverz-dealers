"use client";

import { useCallback, useMemo, useState } from "react";
import { useT } from "@/hooks/use-locale";
import { useFormat } from "@/hooks/use-format";
import type { AdminConversationRow } from "@/lib/admin/conversations";
import {
  useAdminData,
  PageHeader,
  Loading,
  LoadError,
  DataTable,
  Panel,
  StatusPill,
  Muted,
  type Column,
} from "../_components/admin-ui";
import { SearchInput, RefreshButton } from "../_components/filters";

/**
 * Todas las conversaciones de la plataforma.
 *
 * Hasta acá el panel veía cuántas tenía cada cuenta y nada más: para entender
 * por qué un comercio dice que «la IA no contesta» había que entrar a su cuenta.
 * Esto lo contesta desde afuera — en qué canal, quién la tiene, si la IA está
 * prendida en ESE hilo, cuántos mensajes lleva y cuándo fue el último.
 *
 * **Sin una palabra de lo que se dijeron.** El cuerpo de un mensaje y el nombre
 * o el teléfono del comprador son datos de los clientes DE un comercio, que
 * nunca aceptaron nada con Riverz.
 */

interface Payload {
  rows: AdminConversationRow[];
  total: number;
}

const CANALES = [
  "",
  "whatsapp",
  "instagram",
  "messenger",
  "webchat",
  "gmail",
  "outlook",
  "mercadolibre",
  "tiktok_comment",
];

export default function AdminConversationsPage() {
  const t = useT();
  const format = useFormat();
  const [workspace, setWorkspace] = useState("");
  const [channel, setChannel] = useState("");
  const [abierta, setAbierta] = useState<{
    id: string;
    cargando: boolean;
    mensajes: Mensaje[];
    motivo: string | null;
  } | null>(null);

  const url = `/api/admin/conversations?limit=200&workspace=${encodeURIComponent(
    workspace,
  )}&channel=${encodeURIComponent(channel)}`;
  const { data, loading, error, reload, live } = useAdminData<Payload>(url);

  /**
   * Abrir un hilo.
   *
   * Sin permiso del comercio esto devuelve 403 con el motivo, y el motivo se
   * muestra. Devolver una lista vacía se leería como «no hay mensajes», que es
   * peor que decir que no se puede.
   */
  const abrir = useCallback(async (id: string) => {
    setAbierta({ id, cargando: true, mensajes: [], motivo: null });
    try {
      const res = await fetch(`/api/admin/conversations/${id}`, { cache: "no-store" });
      const json = (await res.json()) as {
        mensajes?: Mensaje[];
        error?: string;
      };
      setAbierta({
        id,
        cargando: false,
        mensajes: json.mensajes ?? [],
        motivo: res.ok ? null : t("admin.convNoPermission"),
      });
    } catch {
      setAbierta({ id, cargando: false, mensajes: [], motivo: t("admin.convNoPermission") });
    }
  }, [t]);

  const columns = useMemo<Column<AdminConversationRow>[]>(
    () => [
      {
        key: "workspace",
        header: t("admin.workspace"),
        cell: (r) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">
              {r.workspace_name ?? r.workspace_id.slice(0, 8)}
            </p>
            <Muted>{r.channel}</Muted>
          </div>
        ),
      },
      {
        key: "estado",
        header: t("admin.convState"),
        cell: (r) => (
          <StatusPill
            tone={
              r.needs_human ? "warn" : r.status === "open" ? "ok" : "muted"
            }
            label={
              r.needs_human
                ? t("admin.convNeedsHuman")
                : t(`admin.convStatus_${r.status ?? "open"}`)
            }
          />
        ),
      },
      {
        key: "ia",
        header: t("admin.convAi"),
        cell: (r) => (
          <Muted>{r.ai_enabled ? t("admin.convAiOn") : t("admin.convAiOff")}</Muted>
        ),
      },
      {
        key: "mensajes",
        header: t("admin.convMessages"),
        cell: (r) => <span className="tabular-nums">{r.messages_count}</span>,
      },
      {
        key: "ultimo",
        header: t("admin.convLast"),
        cell: (r) => (
          <Muted>
            {r.last_message_at ? format.date(r.last_message_at) : "—"}
          </Muted>
        ),
      },
      {
        key: "abrir",
        header: "",
        cell: (r) => (
          <button
            type="button"
            onClick={() => void abrir(r.id)}
            className="text-xs text-accent-ink hover:underline"
          >
            {t("admin.convOpen")}
          </button>
        ),
      },
    ],
    [abrir, format, t],
  );

  if (loading && !data) return <Loading forma="table" />;
  if (error || !data) return <LoadError onRetry={reload} />;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("admin.sectionConversations")}
        description={t("admin.sectionConversationsDesc")}
        live={live}
        actions={
          <>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
            >
              {CANALES.map((c) => (
                <option key={c} value={c}>
                  {c || t("admin.convAllChannels")}
                </option>
              ))}
            </select>
            <SearchInput
              value={workspace}
              onChange={setWorkspace}
              placeholder={t("admin.convWorkspaceId")}
            />
            <RefreshButton onClick={reload} />
          </>
        }
      />

      <p className="text-xs text-muted-foreground">
        {t("admin.convPrivacy")}
      </p>

      <DataTable rows={data.rows} columns={columns} rowKey={(r) => r.id} />

      {abierta && (
        <Panel title={t("admin.sectionConversations")}>
          <div className="max-h-[28rem] space-y-2 overflow-y-auto p-4">
            {abierta.cargando ? (
              <Muted>…</Muted>
            ) : abierta.motivo ? (
              <p className="text-sm text-amber-600 dark:text-amber-400">{abierta.motivo}</p>
            ) : abierta.mensajes.length === 0 ? (
              <Muted>—</Muted>
            ) : (
              abierta.mensajes.map((m) => (
                <div
                  key={m.id}
                  className={
                    m.direction === "outbound"
                      ? "ml-auto max-w-[75%] rounded-lg bg-primary/15 px-3 py-2"
                      : "mr-auto max-w-[75%] rounded-lg bg-muted px-3 py-2"
                  }
                >
                  <p className="text-sm whitespace-pre-wrap text-foreground">
                    {m.content_text ?? "—"}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {m.sender_type ?? m.direction} · {format.date(m.created_at)}
                  </p>
                </div>
              ))
            )}
          </div>
          <div className="border-t border-border px-4 py-2">
            <button
              type="button"
              onClick={() => setAbierta(null)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {t("admin.billingCancel")}
            </button>
          </div>
        </Panel>
      )}
    </div>
  );
}

interface Mensaje {
  id: string;
  direction: string | null;
  sender_type: string | null;
  content_text: string | null;
  created_at: string;
}
