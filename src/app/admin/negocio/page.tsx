"use client";

import { useT } from "@/hooks/use-locale";
import { Tabs, useTabParam } from "../_components/admin-ui";
import { Negocio } from "./_negocio";
import { Uso } from "./_uso";

/**
 * La plata del negocio, en tres cortes de la misma pregunta.
 *
 * `Uso y costos` era una sección aparte y tenía una tabla por comercio con una
 * columna de costo, igual que la de `Cuentas`. Eran dos tablas parecidas con
 * universos distintos —Cuentas lista a los que tienen fila de suscripción, Uso
 * a todos los comercios vivos— y métricas de nombre parecido que no se pueden
 * comparar: «conversaciones facturables» no es «respuestas de IA». Puestas una
 * pestaña al lado de la otra, la diferencia se lee; en dos secciones distintas
 * parecían contradecirse.
 *
 * Desde el paso 3 las dos columnas de costo salen del mismo lugar, así que ya
 * no pueden discrepar.
 *
 * Sólo se monta la pestaña activa: abrir `?tab=uso` no dispara el pedido de
 * facturación, y al revés.
 */
const PESTANAS = ["cuentas", "uso", "precios"] as const;

export default function AdminNegocioPage() {
  const t = useT();
  const [tab, setTab] = useTabParam("tab", PESTANAS, "cuentas");

  return (
    <div className="space-y-5">
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: "cuentas", label: t("admin.billingAccounts") },
          { value: "uso", label: t("admin.sectionUsage") },
          { value: "precios", label: t("admin.businessTabPrices") },
        ]}
      />
      {tab === "uso" ? <Uso /> : <Negocio vista={tab} />}
    </div>
  );
}
