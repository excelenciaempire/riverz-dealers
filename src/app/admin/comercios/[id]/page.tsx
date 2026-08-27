"use client";

import { use, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import Link from "@/components/i18n/locale-link";
import { useT } from "@/hooks/use-locale";
import { useFormat } from "@/hooks/use-format";
import { useFetchWithCsrf } from "@/lib/api/fetch-with-csrf";
import { cn } from "@/lib/utils";
import { FEATURES, OPT_IN_FEATURES } from "@/lib/admin/feature-flags";
import type { WorkspaceDetail } from "@/lib/admin/queries";
import {
  useAdminData,
  PageHeader,
  Panel,
  Loading,
  LoadError,
  Empty,
  StatusPill,
  Muted,
  Clamp,
  type Tone,
} from "../../_components/admin-ui";
import { SuspensionSwitch } from "../../_components/suspension-switch";
import { MotorSwitch } from "../../_components/motor-switch";

/** Ficha de un comercio: quién es, qué tiene conectado y qué le está fallando. */
export default function AdminWorkspaceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const t = useT();
  const format = useFormat();
  const { data, loading, error, reload, live } = useAdminData<WorkspaceDetail>(
    `/api/admin/workspaces/${id}`,
  );

  if (loading) return <Loading />;
  if (error || !data)
    return (
      <div className="space-y-4">
        <BackLink label={t("admin.workspacesTitle")} />
        <LoadError onRetry={reload} />
      </div>
    );

  const {
    workspace,
    owner,
    members,
    connections,
    agents,
    counts,
    recentErrors,
    issues,
  } = data;

  return (
    <div className="space-y-5">
      <BackLink label={t("admin.workspacesTitle")} />

      <PageHeader
        live={live}
        title={workspace.name}
        description={[owner?.email, workspace.timezone]
          .filter(Boolean)
          .join(" · ")}
      />

      {/* Los dos interruptores, arriba de todo: son lo único de esta pantalla
          que cambia lo que el comercio puede hacer. El motor lo deja mudo pero
          adentro; suspender además lo saca. */}
      <Panel title={t("admin.motorTitle")}>
        <MotorSwitch
          workspaceId={workspace.id}
          motorApagadoAt={workspace.motor_apagado_at ?? null}
          onDone={reload}
        />
      </Panel>

      <Panel title={t("admin.suspendTitle")}>
        <SuspensionSwitch
          workspaceId={workspace.id}
          suspendedAt={workspace.suspended_at}
          suspendedReason={workspace.suspended_reason}
          onDone={reload}
        />
      </Panel>

      {/* Lo que está roto AHORA — el mismo criterio que ve el comercio en su
          Inicio. Va antes que los números: los últimos errores son historial,
          esto es estado, y una corrida trabada no deja línea de error. */}
      {issues.length > 0 && (
        <Panel title={t("health.needsAttention")}>
          <ul className="divide-y divide-border">
            {issues.map((issue) => (
              <li
                key={`${issue.kind}-${issue.href}`}
                className="flex items-start gap-2.5 px-4 py-2.5 text-sm"
              >
                <span
                  className={
                    issue.severity === "critical"
                      ? "mt-1.5 size-1.5 shrink-0 rounded-full bg-red-500"
                      : "mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500"
                  }
                />
                <span className="min-w-0 flex-1 text-foreground">
                  {t(`health.${issue.kind}`, { n: issue.count })}
                  {issue.detail && (
                    <span className="text-muted-foreground"> · {issue.detail}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {/* Volumen */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {(
          [
            ["colContacts", counts.contacts],
            ["kpiConversations", counts.conversations],
            ["countFlows", counts.flows],
            ["countAutomations", counts.automations],
            ["countBroadcasts", counts.broadcasts],
            ["countProducts", counts.products],
            ["colOrders", counts.orders],
          ] as const
        ).map(([key, value]) => (
          <div key={key} className="rounded-lg border border-border bg-card p-3">
            <p className="truncate text-xs text-muted-foreground">
              {t(`admin.${key}`)}
            </p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
              {format.number(value)}
            </p>
          </div>
        ))}
      </div>

      {/* Conexiones */}
      <Panel title={t("admin.connections")}>
        {connections.length === 0 ? (
          <Empty />
        ) : (
          <ul className="divide-y divide-border">
            {connections.map((c) => (
              <li key={c.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {c.channel}
                      {c.label && (
                        <span className="ml-2 font-normal text-muted-foreground">
                          {c.label}
                        </span>
                      )}
                    </p>
                    <Muted>{c.external_account_id ?? "—"}</Muted>
                  </div>
                  <StatusPill
                    tone={connectionTone(c.status)}
                    label={t(`admin.status${capitalize(c.status)}`)}
                  />
                </div>
                {(c.last_error || c.quality_rating || c.messaging_limit_tier) && (
                  <dl className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-3">
                    {c.last_error && (
                      <div className="sm:col-span-3">
                        <dt className="inline">{t("admin.lastError")}: </dt>
                        <dd className="inline text-red-600 dark:text-red-400">
                          <Clamp text={c.last_error} />
                        </dd>
                      </div>
                    )}
                    {c.quality_rating && (
                      <div>
                        {t("admin.qualityRating")}: {c.quality_rating}
                      </div>
                    )}
                    {c.messaging_limit_tier && (
                      <div>
                        {t("admin.tier")}: {c.messaging_limit_tier}
                      </div>
                    )}
                    {c.last_synced_at && (
                      <div>
                        {t("admin.lastSync")}: {format.dateTime(c.last_synced_at)}
                      </div>
                    )}
                  </dl>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Equipo */}
        <Panel title={t("admin.members")}>
          {members.length === 0 ? (
            <Empty />
          ) : (
            <ul className="divide-y divide-border">
              {members.map((m) => (
                <li
                  key={m.user_id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-foreground">
                      {m.full_name ?? m.email ?? m.user_id}
                    </p>
                    <Muted>{m.email ?? "—"}</Muted>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs text-foreground">
                      {m.role === "admin"
                        ? t("admin.roleAdmin")
                        : t("admin.roleAgent")}
                    </p>
                    <Muted>
                      {m.allowed_sections === null
                        ? t("admin.sectionsAll")
                        : t("admin.sectionsLimited", {
                            n: m.allowed_sections.length,
                          })}
                    </Muted>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* Agentes */}
        <Panel title={t("admin.agents")}>
          {agents.length === 0 ? (
            <Empty />
          ) : (
            <ul className="divide-y divide-border">
              {agents.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-foreground">{a.name}</p>
                    <Muted>
                      {[a.model, a.response_mode, a.language]
                        .filter(Boolean)
                        .join(" · ")}
                    </Muted>
                  </div>
                  <StatusPill
                    tone={a.is_active ? "ok" : "muted"}
                    label={
                      a.is_active ? t("admin.agentActive") : t("admin.agentPaused")
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* Errores recientes */}
      <Panel title={t("admin.recentErrors")}>
        {recentErrors.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            {t("admin.allClear")}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {recentErrors.map((e, i) => (
              <li key={`${e.kind}-${i}`} className="flex gap-3 px-4 py-2.5 text-sm">
                <span className="w-24 shrink-0 text-xs text-muted-foreground">
                  {e.at ? format.dateTime(e.at) : "—"}
                </span>
                <span className="w-24 shrink-0 text-xs text-muted-foreground">
                  {e.kind}
                </span>
                <Clamp text={e.detail} />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <WorkspaceFeatures
        workspaceId={workspace.id}
        global={data.features.global}
        overrides={data.features.overrides}
        onChanged={reload}
      />
    </div>
  );
}

/**
 * Funcionalidades de ESTE comercio.
 *
 * El interruptor de /admin/funcionalidades es global: prende o apaga algo para
 * todas las cuentas. Acá se escribe la excepción, que es lo que hace falta para
 * probar algo con un comercio piloto o para dejar una función fuera de una
 * cuenta que no la contrató.
 *
 * Tres estados a propósito, y no dos: "como el global" tiene que ser distinto
 * de "prendida", porque si no, poner la excepción una vez ya no se puede
 * deshacer nunca.
 */
function WorkspaceFeatures({
  workspaceId,
  global,
  overrides,
  onChanged,
}: {
  workspaceId: string;
  global: Record<string, boolean>;
  overrides: Record<string, boolean>;
  onChanged: () => void;
}) {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [saving, setSaving] = useState<string | null>(null);

  const set = async (key: string, value: boolean | null) => {
    setSaving(key);
    try {
      const res = await fetchWithCsrf("/api/admin/feature-flags", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, enabled: value, workspaceId }),
      });
      if (!res.ok) throw new Error("failed");
      toast.success(t("admin.featureSaved"));
      onChanged();
    } catch {
      toast.error(t("admin.featureSaveError"));
    } finally {
      setSaving(null);
    }
  };

  return (
    <Panel title={t("admin.wsFeaturesTitle")}>
      <p className="px-4 pt-3 text-xs text-muted-foreground">
        {t("admin.wsFeaturesDesc")}
      </p>
      <ul className="mt-1 divide-y divide-border">
        {/* Los dos catálogos en una sola lista, cada uno con su regla para la
            ausencia de fila: las funcionalidades vienen prendidas de fábrica,
            las experiencias nuevas apagadas. Acá se prende Riverz 2.0 para un
            comercio piloto sin tocar al resto. */}
        {[
          ...FEATURES.map((f) => ({ f, globalOn: global[f.key] !== false })),
          ...OPT_IN_FEATURES.map((f) => ({ f, globalOn: global[f.key] === true })),
        ].map(({ f, globalOn }) => {
          const override = overrides[f.key];
          const current: "global" | "on" | "off" =
            override === undefined ? "global" : override ? "on" : "off";
          return (
            <li key={f.key} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-foreground">{t(f.labelKey)}</p>
                <Muted>
                  {t(globalOn ? "admin.wsFeatureGlobalOn" : "admin.wsFeatureGlobalOff")}
                </Muted>
              </div>
              <div className="flex shrink-0 gap-1">
                {(
                  [
                    ["global", null, "admin.wsFeatureFollow"],
                    ["on", true, "admin.wsFeatureOn"],
                    ["off", false, "admin.wsFeatureOff"],
                  ] as const
                ).map(([id, value, label]) => (
                  <button
                    key={id}
                    disabled={saving === f.key}
                    onClick={() => set(f.key, value)}
                    className={cn(
                      "h-7 rounded-md px-2.5 text-xs transition-colors disabled:opacity-50",
                      current === id
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {t(label)}
                  </button>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function BackLink({ label }: { label: string }) {
  return (
    <Link
      href="/admin/comercios"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="size-4" />
      {label}
    </Link>
  );
}

function connectionTone(status: string): Tone {
  if (status === "connected") return "ok";
  if (status === "error" || status === "expired") return "error";
  if (status === "pending") return "warn";
  return "muted";
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
