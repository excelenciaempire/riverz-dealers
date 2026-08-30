"use client";

import { useT } from "@/hooks/use-locale";
import { useFormat } from "@/hooks/use-format";
import type { Caja, CosteDeRecarga } from "@/lib/admin/caja";
import {
  useAdminData,
  Panel,
  Loading,
  LoadError,
  DataTable,
  Muted,
  type Column,
} from "../_components/admin-ui";

/**
 * Lo que cuesta meterle plata a cada plataforma.
 *
 * No es el precio por uso —ese se ve en Negocio— sino la fricción de la
 * recarga: el recargo por pagar con tarjeta, el mínimo y si los créditos
 * vencen. Es lo que decide CUÁNTO y CADA CUÁNTO conviene cargar, y no está en
 * ninguna API: se investigó una vez y vive compilado en `lib/admin/caja`.
 *
 * Va en su propia pestaña porque es una tabla de referencia que no cambia:
 * arriba, empujaba hacia abajo lo único que sí hay que mirar todos los días.
 */
export function Recargas() {
  const t = useT();
  const format = useFormat();
  const { data, loading, error, reload } = useAdminData<Caja>("/api/admin/caja", 0);

  if (loading && !data) return <Loading forma="table" />;
  if (error || !data) return <LoadError onRetry={reload} />;

  return (
    <div className="space-y-6">
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
