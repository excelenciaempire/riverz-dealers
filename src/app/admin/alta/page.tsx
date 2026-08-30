"use client";

import { useT } from "@/hooks/use-locale";
import { Tabs, useTabParam } from "../_components/admin-ui";
import { Codigos } from "./_codigos";
import { Espera } from "./_espera";

/**
 * El alta, de punta a punta.
 *
 * Eran dos secciones y son las dos mitades del mismo embudo: quién dejó su
 * correo antes de que hubiera producto, y quién tiene con qué crear la cuenta.
 * Separadas, la lista de espera era una tabla de tres columnas sin ninguna
 * acción —la sección más liviana del panel— y había que acordarse de mirar las
 * dos para contestar «¿cómo viene el alta?».
 *
 * Sólo se monta la pestaña activa: la otra no pide su JSON hasta que se la
 * abre.
 */
const PESTANAS = ["codigos", "espera"] as const;

export default function AdminAltaPage() {
  const t = useT();
  const [tab, setTab] = useTabParam("tab", PESTANAS, "codigos");

  return (
    <div className="space-y-5">
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: "codigos", label: t("admin.sectionCodes") },
          { value: "espera", label: t("admin.sectionWaitlist") },
        ]}
      />
      {tab === "codigos" ? <Codigos /> : <Espera />}
    </div>
  );
}
