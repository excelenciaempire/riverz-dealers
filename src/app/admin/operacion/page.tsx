"use client";

import { useT } from "@/hooks/use-locale";
import { Tabs, useTabParam } from "../_components/admin-ui";
import { Ahora } from "./_ahora";
import { Historial } from "./_historial";

/**
 * Qué está corriendo, y qué corrió.
 *
 * Eran dos secciones —Operación y Registros— y son el mismo tema mirado a dos
 * distancias: la última corrida de cada trabajo, y el historial completo. La
 * separación tenía sentido y la sigue teniendo (una contesta «¿está andando?» y
 * la otra «¿falla siempre o falló una vez?»), pero eran dos entradas en el
 * índice para una sola pregunta, y los webhooks sin procesar se listaban en las
 * dos con exactamente la misma consulta.
 *
 * La sub-pestaña del historial viaja aparte, en `?kind=`, porque no es la misma
 * dimensión: `?tab=historial&kind=webhooks` es un enlace que lleva justo a la
 * fuente que hace falta mirar, y de ahí lo usa el contador de la otra pestaña.
 */
const PESTANAS = ["ahora", "historial"] as const;

export default function AdminOperacionPage() {
  const t = useT();
  const [tab, setTab] = useTabParam("tab", PESTANAS, "ahora");

  return (
    <div className="space-y-5">
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: "ahora", label: t("admin.opsTabNow") },
          { value: "historial", label: t("admin.opsTabHistory") },
        ]}
      />
      {tab === "ahora" ? <Ahora /> : <Historial />}
    </div>
  );
}
