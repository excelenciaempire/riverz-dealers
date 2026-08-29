"use client";

import { useT } from "@/hooks/use-locale";
import { useFormat } from "@/hooks/use-format";
import type {
  EstadoDeProveedores,
  Proveedor,
  EstadoProveedor,
} from "@/lib/admin/proveedores";
import type { CostoFijo, ProyectoFijo } from "@/lib/admin/costos-fijos";
import {
  useAdminData,
  PageHeader,
  Panel,
  Loading,
  LoadError,
  StatusPill,
  Stat,
  Muted,
  type Tone,
} from "../_components/admin-ui";
import { RefreshButton } from "../_components/filters";

/**
 * Todo lo que hay que pagar para que Riverz siga prendido.
 *
 * Reemplaza a las dos pantallas que había —Saldos e Infraestructura—, que
 * sondeaban los mismos cinco proveedores con dos capas de código distintas y
 * podían mostrar números distintos el mismo día.
 *
 * Las llaves se administran en su propia sección (/admin/claves): acá colgaban
 * de las filas y mezclaban «con qué se trabaja» con «cuánto sale».
 *
 * Tres bloques, en el orden en que se preguntan:
 *
 *  - **¿Me alcanza para hoy?** Lo que se recarga. Es lo que se agota sin avisar:
 *    cuando uno llega a cero la plataforma no devuelve un error claro, devuelve
 *    silencio — el agente deja de contestar, la llamada no sale, la voz no suena.
 *  - **¿Está todo funcionando?** Lo que no tiene saldo pero sí se puede caer.
 *  - **¿Cuánto sale el mes?** Lo fijo, que se paga aunque no lo use nadie.
 *
 * No se refresca sola (`intervalMs: 0`) a propósito: varias de estas sondas son
 * completions FACTURABLES. Se consulta al abrir y al tocar Actualizar.
 */

const TONO: Record<EstadoProveedor, Tone> = {
  ok: "ok",
  bajo: "warn",
  sin_saldo: "error",
  error: "error",
  desconocido: "muted",
  sin_llave: "muted",
};

export default function AdminProveedoresPage() {
  const t = useT();
  const format = useFormat();
  const { data, loading, error, reload } = useAdminData<EstadoDeProveedores>(
    "/api/admin/proveedores",
    0,
  );
  if (loading && !data) return <Loading forma="stats+table" cajas={3} />;
  if (error || !data) return <LoadError onRetry={reload} />;

  const { proveedores, fijos, enRojo, consultadoAt } = data;
  const conSaldo = proveedores.filter((p) => p.recargable);
  const enPie = proveedores.filter((p) => !p.recargable);

  const usd = (n: number) => format.currency(n, "USD", { maximumFractionDigits: 0 });

  /**
   * El número del proveedor, en la unidad que devuelva.
   *
   * La unidad viene de una API de terceros, así que se comprueba que sea un
   * código de moneda antes de pasársela a `Intl`: con uno inválido tira
   * `RangeError` y, en un componente de cliente, eso es la pantalla entera en
   * blanco por el saldo de un proveedor.
   */
  const monto = (p: Proveedor): string => {
    if (p.saldo === null) return "—";
    if (p.unidad === "chars")
      return t("admin.providersChars", { n: format.number(p.saldo) });
    if (p.unidad?.startsWith("/")) return `${format.number(p.saldo)}${p.unidad}`;
    const moneda = p.unidad ?? "USD";
    if (!/^[A-Za-z]{3}$/.test(moneda))
      return `${format.number(p.saldo)} ${moneda}`.trim();
    return format.currency(p.saldo, moneda.toUpperCase());
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("admin.sectionProviders")}
        description={t("admin.sectionProvidersDesc")}
        actions={<RefreshButton onClick={reload} />}
      />

      {/* El CRM primero y solo: es la cifra que decide si el precio de un plan
          cierra. Pegado al total de la cuenta, se leía cuatro veces más caro de
          lo que es, porque la misma cuenta paga tres proyectos más. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={t("admin.balancesToTopUp")}
          value={format.number(enRojo)}
          tone={enRojo === 0 ? "ok" : "warn"}
          hint={
            enRojo === 0
              ? t("admin.balancesAllGood")
              : `${t("admin.providersChecked")} ${format.time(consultadoAt)}`
          }
        />
        <Stat
          label={t("admin.fixedCrmMonthly")}
          value={usd(fijos.crmUsdMes)}
          hint={t("admin.fixedCrmMonthlyHint")}
        />
        <Stat label={t("admin.fixedOthersMonthly")} value={usd(fijos.otrosUsdMes)} />
        <Stat
          label={t("admin.fixedMonthly")}
          value={usd(fijos.totalUsdMes)}
          hint={
            fijos.sinMedir > 0
              ? t("admin.fixedUnmeasured", { n: fijos.sinMedir })
              : undefined
          }
        />
      </div>

      <Panel title={t("admin.providersMoneyBlock")}>
        <ul className="divide-y divide-border">
          {conSaldo.map((p) => (
            <Fila key={p.id} p={p} monto={monto(p)} accion={t("admin.balancesTopUp")} />
          ))}
        </ul>
      </Panel>

      <Panel title={t("admin.providersUpBlock")}>
        <ul className="divide-y divide-border">
          {enPie.map((p) => (
            <Fila key={p.id} p={p} monto={monto(p)} accion={t("admin.balancesOpen")} />
          ))}
        </ul>
      </Panel>

      {/* Un bloque por proyecto, con su subtotal en el encabezado. Antes era una
          sola lista de catorce servicios de cuatro productos distintos: se veía
          todo y no se podía contestar cuánto cuesta ninguno. */}
      {fijos.proyectos.map((g) => (
        <GrupoFijo key={g.id} g={g} usd={usd} />
      ))}
    </div>
  );
}

function GrupoFijo({ g, usd }: { g: ProyectoFijo; usd: (n: number) => string }) {
  const t = useT();
  return (
    <Panel
      title={`${t("admin.providersMonthBlock")} · ${g.nombreKey ? t(g.nombreKey) : g.nombre}`}
      actions={
        <span className="text-sm font-medium tabular-nums text-foreground">
          {usd(g.usdMes)}
          {t("admin.perMonth")}
        </span>
      }
    >
      <ul className="divide-y divide-border">
        {g.items.map((f) => (
          <FilaFija key={f.id} f={f} usd={usd} />
        ))}
      </ul>
    </Panel>
  );
}

function Fila({
  p,
  monto,
  accion,
}: {
  p: Proveedor;
  monto: string;
  accion: string;
}) {
  const t = useT();
  const format = useFormat();
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="font-medium text-foreground">{p.nombre}</p>
        <Muted>
          {p.detalleKey ? t(p.detalleKey, { v: p.detalle ?? "" }) : p.detalle}
        </Muted>
        {/* Los modelos no publican saldo, pero el gasto lo generamos nosotros:
            los tokens salen de `ai_replies` y el USD de la tarifa por modelo. */}
        {p.consumo && (
          <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
            {t("admin.providersSpent", {
              tokens: format.number(p.consumo.tokens, { notation: "compact" }),
              usd: format.currency(p.consumo.usdMes, "USD"),
            })}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="tabular-nums text-foreground">{monto}</span>
        {/* Sin llave se ve acá y se carga en Llaves: esta pantalla es la plata. */}
        <StatusPill tone={TONO[p.estado]} label={t(`admin.balanceState_${p.estado}`)} />
        {p.url && (
          <a
            href={p.url}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-accent-ink hover:underline"
          >
            {accion}
          </a>
        )}
      </div>
    </li>
  );
}

function FilaFija({ f, usd }: { f: CostoFijo; usd: (n: number) => string }) {
  const t = useT();
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className={f.activo ? "font-medium text-foreground" : "text-muted-foreground"}>
          {f.nombre}
        </p>
        <Muted>{t(f.detalleKey, { v: f.detalleExtra ?? "" })}</Muted>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="tabular-nums text-foreground">
          {f.usdMes === null
            ? "—"
            : f.usdMes === 0
              ? t("admin.fixedFree")
              : `${usd(f.usdMes)}${t("admin.perMonth")}`}
        </span>
        <a
          href={f.url}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-accent-ink hover:underline"
        >
          {t("admin.balancesOpen")}
        </a>
      </div>
    </li>
  );
}
