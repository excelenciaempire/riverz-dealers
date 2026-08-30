"use client";

import { useT } from "@/hooks/use-locale";
import { Tabs, useTabParam } from "../_components/admin-ui";
import { Texto } from "./_texto";
import { Voz } from "./_voz";

/**
 * La IA de la plataforma: la que escribe y la que habla.
 *
 * Eran dos secciones —«Clave de IA» y «Voz»— y las dos contestan lo mismo con
 * qué modelo y con qué llave trabaja Riverz para todos los comercios. La de
 * texto además dice quién paga cada cuenta; la de voz elige el modelo de cada
 * capa. Separadas, la palabra «modelo» aparecía en dos lugares del índice y
 * ninguno de los dos decía cuál.
 *
 * La llave de Anthropic ya no se carga acá: se cargaba en esta pantalla Y en
 * Llaves, las dos escribiendo la MISMA columna y mostrando pistas distintas de
 * la misma clave. Ahora hay un solo escritor y esta pantalla enlaza a él.
 */
const PESTANAS = ["texto", "voz"] as const;

export default function AdminIaPage() {
  const t = useT();
  const [tab, setTab] = useTabParam("tab", PESTANAS, "texto");

  return (
    <div className="space-y-5">
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: "texto", label: t("admin.aiTabText") },
          { value: "voz", label: t("admin.aiTabVoice") },
        ]}
      />
      {tab === "texto" ? <Texto /> : <Voz />}
    </div>
  );
}
