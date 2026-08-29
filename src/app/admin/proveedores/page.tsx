"use client";

import { useT } from "@/hooks/use-locale";
import { useFormat } from "@/hooks/use-format";
import type {
  EstadoDeProveedores,
  Proveedor,
  EstadoProveedor,
} from "@/lib/admin/proveedores";
import type { CostoFijo } from "@/lib/admin/costos-fijos";
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

  /** El número del proveedor, en la unidad que devuelva. */
  const monto = (p: Proveedor): string => {
    if (p.saldo === null) return "—";
    if (p.unidad === "chars")
      return t("admin.providersChars", { n: format.number(p.saldo) });
    if (p.unidad && p.unidad.startsWith("/")) return `${format.number(p.saldo)}${p.unidad}`;
    return format.currency(p.saldo, p.unidad ?? "USD");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("admin.sectionProviders")}
        description={t("admin.sectionProvidersDesc")}
        actions={<RefreshButton onClick={reload} />}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat
          label={t("admin.balancesToTopUp")}
          value={format.number(enRojo)}
          tone={enRojo === 0 ? "ok" : "warn"}
          hint={enRojo === 0 ? t("admin.balancesAllGood") : undefined}
        />
        <Stat
          label={t("admin.fixedMonthly")}
          value={usd(fijos.totalUsdMes)}
          hint={
            fijos.sinMedir > 0
              ? t("admin.fixedUnmeasured", { n: fijos.sinMedir })
              : undefined
          }
        />
        <Stat
          label={t("admin.balancesProviders")}
          value={format.number(proveedores.length)}
          hint={`${t("admin.providersChecked")} ${format.time(consultadoAt)}`}
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

      <Panel title={t("admin.providersMonthBlock")}>
        <ul className="divide-y divide-border">
          {fijos.items.map((f) => (
            <FilaFija key={f.id} f={f} usd={usd} />
          ))}
        </ul>
      </Panel>
    </div>
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
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="font-medium text-foreground">{p.nombre}</p>
        <Muted>
          {p.detalleKey ? t(p.detalleKey, { v: p.detalle ?? "" }) : p.detalle}
        </Muted>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="tabular-nums text-foreground">{monto}</span>
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
