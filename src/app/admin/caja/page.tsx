"use client";

import { ChevronRight } from "lucide-react";
import { useT } from "@/hooks/use-locale";
import { useFormat } from "@/hooks/use-format";
import type { Caja, CosteDeRecarga, Paso } from "@/lib/admin/caja";
import {
  useAdminData,
  PageHeader,
  Panel,
  Loading,
  LoadError,
  DataTable,
  StatusPill,
  Stat,
  Muted,
  type Column,
  type Tone,
} from "../_components/admin-ui";
import { RefreshButton } from "../_components/filters";

/**
 * La caja: cuánta plata hay, cuántos días aguanta y qué recargar ahora.
 *
 * Proveedores contesta «¿cuánto le queda a cada API?» y Negocio «¿cuánto
 * factura Riverz?». Ninguna de las dos contesta la que se hace un lunes a la
 * mañana: **¿tengo con qué pagar lo que los comercios van a consumir esta
 * semana?** Eso pasa por tres plazos distintos —el comercio gasta hoy, Stripe
 * deposita en dos días hábiles, el proveedor cobra por adelantado— y sumarlos
 * mal es como se llega a un proveedor en cero con la cuenta de Stripe llena.
 *
 * No se refresca sola (`intervalMs: 0`): abajo reusa la ronda de proveedores,
 * que incluye sondas FACTURABLES. Se consulta al abrir y al tocar Actualizar.
 */

const TONO_ESTADO: Record<string, Tone> = {
  ok: "ok",
  bajo: "warn",
  sin_saldo: "error",
  error: "error",
  desconocido: "muted",
  sin_llave: "muted",
};

export default function AdminCajaPage() {
  const t = useT();
  const format = useFormat();
  const { data, loading, error, reload } = useAdminData<Caja>("/api/admin/caja", 0);

  if (loading && !data) return <Loading forma="stats+table" cajas={4} />;
  if (error || !data) return <LoadError onRetry={reload} />;

  const usd = (n: number) => format.currency(n, "USD", { maximumFractionDigits: 0 });
  const usd2 = (n: number) => format.currency(n, "USD", { maximumFractionDigits: 2 });

  const dias = data.diasDeAutonomia;
  const enStripe = (data.stripe.disponibleUsd ?? 0) + (data.stripe.pendienteUsd ?? 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("admin.cashTitle")}
        description={t("admin.cashDesc")}
        actions={<RefreshButton onClick={reload} />}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {/* Primero la caja libre: es el único número de la pantalla que dice si
            el negocio tiene plata propia. Los otros tres la explican. */}
        <Stat
          label={t("admin.cashFree")}
          value={usd(data.cajaLibreUsd)}
          tone={data.cajaLibreUsd < 0 ? "error" : "ok"}
          hint={t("admin.cashFreeHint")}
        />
        <Stat
          label={t("admin.cashInStripe")}
          value={usd(enStripe)}
          hint={
            data.stripe.pendienteUsd
              ? `${usd(data.stripe.disponibleUsd ?? 0)} + ${usd(data.stripe.pendienteUsd)} ${t("admin.cashPending").toLowerCase()}`
              : t("admin.cashAvailableHint")
          }
        />
        <Stat
          label={t("admin.cashInProviders")}
          value={usd(data.enProveedoresUsd)}
          hint={
            data.sinMedir.length
              ? t("admin.cashUnmeasured", { nombres: data.sinMedir.join(", ") })
              : t("admin.cashInProvidersHint")
          }
        />
        <Stat
          label={t("admin.cashRunway")}
          value={
            dias === null
              ? "—"
              : t("admin.cashRunwayDays", { n: format.number(Math.floor(dias)) })
          }
          tone={dias === null ? "muted" : dias < 2 ? "error" : dias < data.colchonDias ? "warn" : "ok"}
          hint={
            data.quemaDiaUsd > 0
              ? t("admin.cashRunwayHint", { usd: data.quemaDiaUsd.toFixed(2) })
              : t("admin.cashRunwayUnknown")
          }
        />
      </div>

      <Panel title={t("admin.cashStepsTitle")}>
        {data.pasos.length === 0 ? (
          <p className="px-4 py-4 text-sm text-emerald-600 dark:text-emerald-400">
            {t("admin.cashAllClear", { n: data.colchonDias })}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {data.pasos.map((p) => (
              <PasoFila key={p.id} paso={p} usd={usd2} />
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={t("admin.cashStripeTitle")}>
          {data.stripe.errorKey ? (
            <p className="px-4 py-4 text-sm text-muted-foreground">
              {/* `fixedMissingEnv` interpola {v} con el nombre de la variable;
                  las otras dos claves no interpolan nada y el dato crudo —un
                  HTTP— va detrás. */}
              {t(data.stripe.errorKey, { v: data.stripe.error ?? "" })}
              {data.stripe.errorKey !== "admin.fixedMissingEnv" && data.stripe.error
                ? ` · ${data.stripe.error}`
                : null}
            </p>
          ) : (
            <dl className="divide-y divide-border text-sm">
              <Linea
                termino={t("admin.cashAvailable")}
                valor={usd2(data.stripe.disponibleUsd ?? 0)}
                nota={t("admin.cashAvailableHint")}
              />
              <Linea
                termino={t("admin.cashPending")}
                valor={usd2(data.stripe.pendienteUsd ?? 0)}
                nota={t("admin.cashPendingHint")}
              />
              <Linea
                termino={t("admin.cashInstant")}
                valor={
                  data.stripe.instantaneoUsd === null
                    ? "—"
                    : usd2(data.stripe.instantaneoUsd)
                }
                nota={
                  data.stripe.instantaneoUsd === null
                    ? t("admin.cashInstantNo")
                    : t("admin.cashInstantHint")
                }
              />
              {data.stripe.agenda && (
                <Linea
                  termino={t("admin.cashSchedule")}
                  valor={t("admin.cashScheduleValue", {
                    intervalo: data.stripe.agenda.intervalo,
                    dias: data.stripe.agenda.demoraDias ?? 2,
                  })}
                />
              )}
              {data.stripe.enCamino.map((p, i) => (
                <Linea
                  key={`${p.estado}-${i}`}
                  termino={t("admin.cashOnTheWay")}
                  valor={usd2(p.usd)}
                  nota={
                    p.llegaAt
                      ? t("admin.cashArrives", { fecha: format.date(p.llegaAt) })
                      : undefined
                  }
                />
              ))}
            </dl>
          )}
        </Panel>

        <Panel title={t("admin.cashProvidersTitle")}>
          <DataTable
            columns={[
              {
                key: "nombre",
                header: t("admin.cashColProvider"),
                cell: (p) =>
                  p.url ? (
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-foreground underline-offset-4 hover:underline"
                    >
                      {p.nombre}
                    </a>
                  ) : (
                    p.nombre
                  ),
              },
              {
                key: "estado",
                header: "",
                cell: (p) => (
                  <StatusPill
                    tone={TONO_ESTADO[p.estado] ?? "muted"}
                    label={t(`admin.balanceState_${p.estado}`)}
                  />
                ),
              },
              {
                key: "saldo",
                header: t("admin.cashColBalance"),
                numeric: true,
                cell: (p) =>
                  p.usd === null ? (
                    <Muted>—</Muted>
                  ) : (
                    usd2(p.usd)
                  ),
              },
            ] as Column<Caja["proveedores"][number]>[]}
            rows={data.proveedores}
            rowKey={(p) => p.id}
          />
          <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
            {t("admin.cashFixed")}: {usd(data.fijoMesUsd)} · {t("admin.cashDebt")}:{" "}
            {usd2(data.deudaUsd)} — {t("admin.cashDebtHint")}
          </p>
        </Panel>
      </div>

      <Panel title={t("admin.cashCostsTitle")}>
        <p className="border-b border-border px-4 py-3 text-xs text-muted-foreground">
          {t("admin.cashCostsDesc")}
        </p>
        <DataTable
          columns={columnasDeCostes(t, format)}
          rows={data.costes}
          rowKey={(c) => c.id}
        />
      </Panel>

      <Panel title={t("admin.cashFeesTitle")}>
        <ul className="divide-y divide-border text-sm">
          {["cashFeeCard", "cashFeePayout", "cashFeeWallet", "cashFeeDispute"].map((k) => (
            <li key={k} className="px-4 py-2.5 text-muted-foreground">
              {t(`admin.${k}`)}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

/** Una fila de «qué hacer ahora»: el texto, y a dónde se va a resolverlo. */
function PasoFila({ paso, usd }: { paso: Paso; usd: (n: number) => string }) {
  const t = useT();
  const texto = t(paso.key, {
    nombre: paso.params.nombre ?? "",
    usd: paso.params.usd === undefined ? "" : usd(paso.params.usd),
    dias: paso.params.dias ?? "",
  });

  const color =
    paso.tono === "error"
      ? "text-red-600 dark:text-red-400"
      : paso.tono === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : "text-foreground";

  const contenido = (
    <>
      <span className={`flex-1 ${color}`}>{texto}</span>
      {paso.href && <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
    </>
  );

  return (
    <li>
      {paso.href ? (
        <a
          href={paso.href}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-muted/50"
        >
          {contenido}
        </a>
      ) : (
        <div className="flex items-center gap-3 px-4 py-3 text-sm">{contenido}</div>
      )}
    </li>
  );
}

/** Término y valor, con la explicación debajo. */
function Linea({
  termino,
  valor,
  nota,
}: {
  termino: string;
  valor: string;
  nota?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
      <div>
        <dt className="text-foreground">{termino}</dt>
        {nota && <dd className="text-xs text-muted-foreground">{nota}</dd>}
      </div>
      <dd className="shrink-0 tabular-nums text-foreground">{valor}</dd>
    </div>
  );
}

function columnasDeCostes(
  t: (k: string, v?: Record<string, string | number>) => string,
  format: ReturnType<typeof useFormat>,
): Column<CosteDeRecarga>[] {
  const venc = (c: CosteDeRecarga) => {
    if (c.venceMeses === null) return t("admin.cashNoExpiry");
    if (c.venceMeses === 0) return t("admin.cashExpiryCycle");
    return t("admin.cashExpiryMonths", { n: c.venceMeses });
  };

  return [
    {
      key: "nombre",
      header: t("admin.cashColProvider"),
      cell: (c) => (
        <a
          href={c.url}
          target="_blank"
          rel="noreferrer"
          className="text-foreground underline-offset-4 hover:underline"
        >
          {c.nombre}
        </a>
      ),
    },
    {
      key: "modelo",
      header: t("admin.cashColModel"),
      cell: (c) => <Muted>{t(`admin.cashModel_${c.modelo}`)}</Muted>,
    },
    {
      key: "recargo",
      header: t("admin.cashColFee"),
      numeric: true,
      cell: (c) =>
        c.recargoPct > 0 ? (
          <span className="text-amber-600 dark:text-amber-400">{c.recargoPct}%</span>
        ) : (
          <Muted>—</Muted>
        ),
    },
    {
      key: "minimo",
      header: t("admin.cashColMin"),
      numeric: true,
      cell: (c) =>
        c.minimoUsd === null ? (
          <Muted>—</Muted>
        ) : (
          format.currency(c.minimoUsd, "USD", { maximumFractionDigits: 0 })
        ),
    },
    {
      key: "vence",
      header: t("admin.cashColExpiry"),
      cell: (c) => <Muted>{venc(c)}</Muted>,
    },
    {
      key: "nota",
      header: "",
      cell: (c) => (c.notaKey ? <Muted>{t(c.notaKey)}</Muted> : null),
    },
  ];
}
