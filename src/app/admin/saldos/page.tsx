"use client";

import { useT } from "@/hooks/use-locale";
import type { SaldoProveedor } from "@/lib/admin/saldos";
import type { Fijos } from "@/lib/admin/costos-fijos";
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
 * Qué hay que pagar para que Riverz siga prendido.
 *
 * Son dos preguntas distintas y por eso hay dos bloques:
 *
 *  - **¿Me alcanza para hoy?** El saldo de cada proveedor que se recarga. Es lo
 *    que se agota sin avisar: cuando uno de esos llega a cero, la plataforma no
 *    devuelve un error claro, devuelve silencio — el agente deja de contestar,
 *    la llamada no sale, la voz no suena.
 *  - **¿Cuánto sale el mes?** Lo fijo, que se paga aunque no lo use nadie.
 *
 * Arriba va el número que resume las dos: cuánto cuesta el mes y cuántos
 * proveedores están pidiendo plata ahora.
 *
 * Lo que ninguna API publica aparece igual, en gris y con su enlace. Esconderlo
 * daría a entender que no hay que mirarlo, y son justo los que se renuevan
 * solos.
 */

interface Payload {
  saldos: SaldoProveedor[];
  fijos: Fijos;
  enRojo: number;
}

const TONO: Record<string, Tone> = {
  ok: "ok",
  bajo: "warn",
  sin_saldo: "error",
  error: "error",
  desconocido: "muted",
  sin_llave: "muted",
};

function monto(s: SaldoProveedor): string {
  if (s.saldo === null) return "—";
  if (s.unidad === "caracteres") return `${Math.round(s.saldo).toLocaleString()} car.`;
  return `${s.saldo.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${s.unidad ?? ""}`.trim();
}

const usd = (n: number) => `US$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export default function AdminSaldosPage() {
  const t = useT();
  const { data, loading, error, reload, live } = useAdminData<Payload>("/api/admin/saldos");

  if (loading && !data) return <Loading />;
  if (error || !data) return <LoadError onRetry={reload} />;

  const { saldos, fijos, enRojo } = data;
  // Los que se recargan van primero; los que no publican saldo, al final.
  const recargables = saldos.filter((s) => s.saldo !== null || s.estado === "sin_saldo");
  const opacos = saldos.filter((s) => !recargables.includes(s));

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("admin.sectionBalances")}
        description={t("admin.sectionBalancesDesc")}
        live={live}
        actions={<RefreshButton onClick={reload} />}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
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
          label={t("admin.balancesToTopUp")}
          value={String(enRojo)}
          tone={enRojo === 0 ? "ok" : "warn"}
          hint={enRojo === 0 ? t("admin.balancesAllGood") : undefined}
        />
        <Stat
          label={t("admin.balancesProviders")}
          value={String(saldos.length + fijos.items.length)}
        />
      </div>

      <Panel title={t("admin.balancesRechargeable")}>
        <ul className="divide-y divide-border">
          {recargables.map((s) => (
            <Fila key={s.id} s={s} t={t} />
          ))}
        </ul>
      </Panel>

      <Panel title={t("admin.fixedMonthly")}>
        <ul className="divide-y divide-border">
          {fijos.items.map((f) => (
            <li
              key={f.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p
                  className={
                    f.activo ? "font-medium text-foreground" : "text-muted-foreground"
                  }
                >
                  {f.nombre}
                </p>
                <Muted>{f.detalle}</Muted>
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
          ))}
        </ul>
      </Panel>

      {opacos.length > 0 && (
        <Panel title={t("admin.balancesNoApi")}>
          <ul className="divide-y divide-border">
            {opacos.map((s) => (
              <Fila key={s.id} s={s} t={t} />
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function Fila({
  s,
  t,
}: {
  s: SaldoProveedor;
  t: (k: string, p?: Record<string, string | number>) => string;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="font-medium text-foreground">{s.nombre}</p>
        <Muted>{s.paraQue}</Muted>
        {s.detalle && <p className="text-xs text-muted-foreground">{s.detalle}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="tabular-nums text-foreground">{monto(s)}</span>
        <StatusPill
          tone={TONO[s.estado] ?? "muted"}
          label={t(`admin.balanceState_${s.estado}`)}
        />
        <a
          href={s.url}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-accent-ink hover:underline"
        >
          {t("admin.balancesTopUp")}
        </a>
      </div>
    </li>
  );
}
