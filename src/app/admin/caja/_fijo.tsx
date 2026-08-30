"use client";

import { useT } from "@/hooks/use-locale";
import { useFormat } from "@/hooks/use-format";
import type { CostoFijo, Fijos, ProyectoFijo } from "@/lib/admin/costos-fijos";
import {
  useAdminData,
  Panel,
  Loading,
  LoadError,
  Muted,
  Stat,
} from "../_components/admin-ui";
import { RefreshButton } from "../_components/filters";

/**
 * Lo que se paga todos los meses aunque no lo use nadie.
 *
 * Vivía en Proveedores, que contesta «¿cuánto le queda a cada API?». Es otra
 * pregunta: los servidores y las bases no se recargan ni se agotan, se pagan
 * con tarjeta el día 1. Va en la Caja, que es donde se mira cuánta plata hace
 * falta —y por eso el costo fijo NO entra en los días de autonomía: no sale del
 * saldo prepago.
 *
 * Pide su propia ruta, gratuita. Cuando venía dentro de la respuesta de
 * proveedores, saber cuánto sale el mes costaba cuatro completions facturables.
 */
export function Fijo() {
  const t = useT();
  const format = useFormat();
  const { data, loading, error, reload } = useAdminData<Fijos>(
    "/api/admin/costos-fijos",
    0,
  );

  if (loading && !data) return <Loading forma="stats+table" cajas={3} />;
  if (error || !data) return <LoadError onRetry={reload} />;

  const usd = (n: number) => format.currency(n, "USD", { maximumFractionDigits: 0 });

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <RefreshButton onClick={reload} />
      </div>

      {/* El CRM primero y solo: es la cifra que decide si el precio de un plan
          cierra. Pegado al total de la cuenta se leía cuatro veces más caro de
          lo que es, porque la misma cuenta paga tres proyectos más. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat
          label={t("admin.fixedCrmMonthly")}
          value={usd(data.crmUsdMes)}
          hint={t("admin.fixedCrmMonthlyHint")}
        />
        <Stat label={t("admin.fixedOthersMonthly")} value={usd(data.otrosUsdMes)} />
        <Stat
          label={t("admin.fixedMonthly")}
          value={usd(data.totalUsdMes)}
          hint={
            data.sinMedir > 0
              ? t("admin.fixedUnmeasured", { n: data.sinMedir })
              : undefined
          }
        />
      </div>

      {/* Un bloque por proyecto, con su subtotal en el encabezado. Antes era una
          sola lista de catorce servicios de cuatro productos distintos: se veía
          todo y no se podía contestar cuánto cuesta ninguno. */}
      {data.proyectos.map((g) => (
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
