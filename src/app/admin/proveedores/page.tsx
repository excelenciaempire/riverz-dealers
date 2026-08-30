"use client";

import { useT } from "@/hooks/use-locale";
import { Tabs, useTabParam } from "../_components/admin-ui";
import { Saldo } from "./_saldo";
import { Llaves } from "./_llaves";

/**
 * Los proveedores: cuánto les queda y con qué llave se les habla.
 *
 * Eran dos secciones sobre los MISMOS nueve proveedores. Llaves nació como una
 * escisión de esta pantalla —el saldo y la llave colgaban de la misma fila y no
 * se leía ninguna de las dos— y la escisión resolvió eso creando el problema de
 * al lado: para saber por qué un proveedor no contesta había que abrir las dos y
 * cruzarlas a mano.
 *
 * **La pestaña importa más de lo habitual: una cuesta plata y la otra no.**
 * `saldo` dispara la ronda de sondas, y cuatro de ellas son completions
 * facturables (Anthropic, Cerebras, Groq, OpenAI). `llaves` es una lectura de
 * tabla. Como sólo se monta la pestaña activa, entrar por `?tab=llaves` a
 * cargar una llave no dispara ninguna sonda.
 *
 * Por eso `_llaves.tsx` no puede importar nada de `_saldo.tsx`: un import
 * inocente para reusar una columna arrastraría el `useAdminData` de la otra y
 * la pestaña gratis dejaría de serlo.
 */
const PESTANAS = ["saldo", "llaves"] as const;

export default function AdminProveedoresPage() {
  const t = useT();
  const [tab, setTab] = useTabParam("tab", PESTANAS, "saldo");

  return (
    <div className="space-y-5">
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: "saldo", label: t("admin.providersTabBalance") },
          { value: "llaves", label: t("admin.sectionKeys") },
        ]}
      />
      {tab === "saldo" ? <Saldo /> : <Llaves />}
    </div>
  );
}
