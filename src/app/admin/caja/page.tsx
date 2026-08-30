"use client";

import { useT } from "@/hooks/use-locale";
import { PageHeader, Tabs, useTabParam } from "../_components/admin-ui";
import { Hoy } from "./_hoy";
import { Fijo } from "./_fijo";
import { Recargas } from "./_recargas";

/**
 * La caja: cuánta plata hay, cuánto aguanta y qué cuesta recargar.
 *
 * Tres preguntas con tres ritmos distintos, y por eso tres pestañas:
 *
 * - `hoy` se mira todos los días: cuánto hay, cuántos días cubre y qué recargar.
 * - `fijo` se mira una vez al mes. Venía de Proveedores, que contesta «¿cuánto
 *   le queda a cada API?» — otra pregunta: los servidores no se recargan, se
 *   pagan con tarjeta el día 1. Y no entra en los días de autonomía justamente
 *   por eso: no sale del saldo prepago.
 * - `recargas` es una tabla de referencia que casi no cambia. Arriba, empujaba
 *   hacia abajo lo único que sí hay que mirar seguido.
 *
 * Cada pestaña pide su propia ruta y sólo se monta la activa. La de `fijo` es
 * gratuita: cuando el bloque venía dentro de la respuesta de proveedores, saber
 * cuánto sale el mes costaba cuatro completions facturables.
 */
const PESTANAS = ["hoy", "fijo", "recargas"] as const;

export default function AdminCajaPage() {
  const t = useT();
  const [tab, setTab] = useTabParam("tab", PESTANAS, "hoy");

  return (
    <div className="space-y-5">
      <PageHeader title={t("admin.cashTitle")} description={t("admin.cashDesc")} />
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: "hoy", label: t("admin.cashTabToday") },
          { value: "fijo", label: t("admin.cashTabFixed") },
          { value: "recargas", label: t("admin.cashCostsTitle") },
        ]}
      />
      {tab === "hoy" ? <Hoy /> : tab === "fijo" ? <Fijo /> : <Recargas />}
    </div>
  );
}
