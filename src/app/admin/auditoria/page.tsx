"use client";

import { useMemo, useState } from "react";
import Link from "@/components/i18n/locale-link";
import { useT } from "@/hooks/use-locale";
import { useFormat } from "@/hooks/use-format";
import { toShortId } from "@/lib/short-id";
import type { AuditRow, PlatformAuditRow } from "@/lib/admin/queries";
import type { Llave } from "@/lib/admin/llaves";
import {
  useAdminData,
  useTabParam,
  Tabs,
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

const SOURCES = ["panel", "agente", "llaves"] as const;
type Source = (typeof SOURCES)[number];

/**
 * Qué se hizo sobre las cuentas, desde los dos lados.
 *
 * *Panel* es lo que miró y cambió el equipo desde /admin. *Agente* es lo que
 * hizo el servidor MCP sobre la cuenta de un comercio — lecturas incluidas,
 * porque sobre datos ajenos saber quién miró qué también es parte de la
 * respuesta. Esa segunda tabla se venía escribiendo desde el primer día y no la
 * leía ninguna pantalla.
 *
 * *Llaves* es la otra mitad de esa pregunta: no qué se hizo, sino qué está
 * habilitado a hacerse. Una llave que nadie usó todavía no deja una sola fila
 * de auditoría — y es justo la que hay que encontrar: la de la laptop que se
 * perdió, la del conector que se probó una vez y quedó.
 */
export default function AdminAuditPage() {
  const t = useT();
  const format = useFormat();
  const [source, setSource] = useTabParam<Source>("tab", SOURCES, "panel");
  const [actor, setActor] = useState("");

  // Las llaves salen de su propia ruta: no son un libro de actas filtrable por
  // actor, son un inventario.
  const url =
    source === "llaves"
      ? "/api/admin/audit/llaves?limit=200"
      : `/api/admin/audit?limit=200&source=${source}&actor=${encodeURIComponent(actor)}`;
  const { data, loading, error, reload, live } = useAdminData<{
    rows: (AuditRow | PlatformAuditRow | Llave)[];
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

  const keyColumns = useMemo<Column<Llave>[]>(
    () => [
      {
        key: "name",
        header: t("admin.keysName"),
        cell: (r) => (
          <div>
            <p className="font-medium text-foreground">{r.nombre}</p>
            {r.prefijo && <Muted>{r.prefijo}…</Muted>}
          </div>
        ),
      },
      {
        key: "type",
        header: t("admin.keysType"),
        cell: (r) => <Muted>{t(`admin.keysType_${r.tipo}`)}</Muted>,
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
        key: "scope",
        header: t("admin.keysScope"),
        cell: (r) => <Clamp text={r.alcance} />,
      },
      {
        key: "created",
        header: t("admin.colWhen"),
        cell: (r) => (
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {r.created_at ? format.dateTime(r.created_at) : "—"}
          </span>
        ),
      },
      {
        // La columna que decide si una llave sobra: una que nunca se usó no
        // está sirviendo a nadie y sigue abriendo la cuenta.
        key: "used",
        header: t("admin.keysLastUsed"),
        cell: (r) =>
          r.last_used_at ? (
            <span className="whitespace-nowrap text-xs text-muted-foreground">
              {format.dateTime(r.last_used_at)}
            </span>
          ) : (
            <Muted>{t("admin.never")}</Muted>
          ),
      },
      {
        key: "state",
        header: t("admin.colStatus"),
        cell: (r) =>
          r.revoked_at ? (
            <StatusPill tone="muted" label={t("admin.keysRevoked")} />
          ) : (
            <StatusPill tone="ok" label={t("admin.keysActive")} />
          ),
      },
    ],
    [t, format],
  );

  const tabs: { value: Source; label: string }[] = [
    { value: "panel", label: t("admin.auditSourcePanel") },
    { value: "agente", label: t("admin.auditSourceAgent") },
    { value: "llaves", label: t("admin.auditSourceKeys") },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        live={live}
        title={t("admin.auditTitle")}
        description={t("admin.auditDesc")}
        actions={
          <>
            {/* Las llaves son un inventario, no un libro de actas: filtrar por
                actor ahí no querría decir nada. */}
            {source !== "llaves" && (
              <SearchInput
                value={actor}
                onChange={setActor}
                placeholder={t("admin.filterActor")}
              />
            )}
            <RefreshButton onClick={reload} />
          </>
        }
      />

      <Tabs value={source} onChange={setSource} options={tabs} />

      <Panel>
        {loading ? (
          <Loading forma="filas" />
        ) : error ? (
          <LoadError onRetry={reload} />
        ) : source === "llaves" ? (
          <DataTable
            columns={keyColumns}
            rows={(data?.rows ?? []) as Llave[]}
            rowKey={(r) => r.id}
          />
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
