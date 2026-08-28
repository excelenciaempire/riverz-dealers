"use client";

import { useT } from "@/hooks/use-locale";
import type { SaldoProveedor } from "@/lib/admin/saldos";
import {
  useAdminData,
  PageHeader,
  Panel,
  Loading,
  LoadError,
  StatusPill,
  Muted,
  type Tone,
} from "../_components/admin-ui";
import { RefreshButton } from "../_components/filters";

/**
 * Cuánto saldo le queda a cada proveedor.
 *
 * Riverz corre con las llaves de Riverz. Cuando uno de esos proveedores se
 * queda sin saldo, la plataforma no devuelve un error claro: devuelve silencio.
 * El agente deja de contestar, la llamada no sale, la voz no suena — y se
 * descubre por un cliente que no recibió respuesta.
 *
 * Por eso lo que primero se lee no es una tabla sino una frase: si hay algo que
 * recargar, o no. La tabla es el detalle para el que ya sabe que sí.
 *
 * El que no publica saldo se muestra igual, en gris y con su enlace. Esconderlo
 * daría a entender que no hay que mirarlo, y son justo los que se caen en
 * silencio.
 */

interface Payload {
  saldos: SaldoProveedor[];
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

export default function AdminSaldosPage() {
  const t = useT();
  const { data, loading, error, reload, live } = useAdminData<Payload>("/api/admin/saldos");

  if (loading && !data) return <Loading />;
  if (error || !data) return <LoadError onRetry={reload} />;

  const { saldos, enRojo } = data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("admin.sectionBalances")}
        description={t("admin.sectionBalancesDesc")}
        live={live}
        actions={<RefreshButton onClick={reload} />}
      />

      <Panel
        title={
          enRojo === 0 ? t("admin.balancesAllGood") : t("admin.balancesNeedTopUp", { n: enRojo })
        }
      >
        <ul className="divide-y divide-border">
          {saldos.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="font-medium text-foreground">{s.nombre}</p>
                <Muted>{s.paraQue}</Muted>
                {s.detalle && (
                  <p className="text-xs text-muted-foreground">{s.detalle}</p>
                )}
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
          ))}
        </ul>
      </Panel>
    </div>
  );
}
