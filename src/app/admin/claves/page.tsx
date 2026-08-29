"use client";

import { useT } from "@/hooks/use-locale";
import { useFormat } from "@/hooks/use-format";
import type { EstadoDeClave, OrigenDeClave } from "@/lib/admin/claves";
import { ClaveEditor } from "../_components/clave-editor";
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
 * Las llaves con las que trabajan los comercios.
 *
 * Vivían repartidas: la de Anthropic en /admin/ia y las otras ocho colgadas de
 * las filas de Proveedores, mezcladas con el saldo. Eran la misma pregunta
 * —¿con qué llave contesta la plataforma?— contestada en dos lugares, y en el
 * segundo había que encontrar la fila del proveedor entre once para llegar.
 *
 * Ahora la plata y las llaves son dos pantallas. Proveedores contesta cuánto
 * hay y cuánto sale; esta contesta con qué se trabaja. Un proveedor sin llave
 * sigue apareciendo allá como «Sin llave», y se carga acá.
 *
 * Lo que falta va primero: una llave ausente no es un ajuste pendiente, es una
 * tarifa de la billetera que hoy no se puede cobrar.
 */

const TONO: Record<OrigenDeClave, Tone> = {
  panel: "ok",
  render: "muted",
  falta: "error",
};

/** Sin llave arriba; después las de Render, que conviene mudar al panel. */
const ORDEN: Record<OrigenDeClave, number> = { falta: 0, render: 1, panel: 2 };

export default function AdminClavesPage() {
  const t = useT();
  const format = useFormat();
  const { data, loading, error, reload, setData } = useAdminData<{
    claves: EstadoDeClave[];
  }>("/api/admin/claves", 0);

  if (loading && !data) return <Loading forma="stats+table" cajas={1} />;
  if (error || !data) return <LoadError onRetry={reload} />;

  const claves = [...data.claves].sort(
    (a, b) => ORDEN[a.origen] - ORDEN[b.origen],
  );
  const faltan = claves.filter((c) => c.origen === "falta").length;
  const enPanel = claves.filter((c) => c.origen === "panel").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("admin.sectionKeys")}
        description={t("admin.sectionKeysDesc")}
        actions={<RefreshButton onClick={reload} />}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat
          label={t("admin.keysMissing")}
          value={format.number(faltan)}
          tone={faltan === 0 ? "ok" : "error"}
          hint={faltan === 0 ? t("admin.keysAllSet") : t("admin.keysMissingHint")}
        />
        <Stat
          label={t("admin.keysFromPanel")}
          value={`${format.number(enPanel)}/${format.number(claves.length)}`}
          hint={t("admin.keysFromPanelHint")}
        />
        <Stat label={t("admin.keysProviders")} value={format.number(claves.length)} />
      </div>

      <Panel title={t("admin.keysBlock")}>
        <ul className="divide-y divide-border">
          {claves.map((c) => (
            <li key={c.id} className="space-y-2 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{c.nombre}</p>
                  <Muted>{t(c.paraQueKey)}</Muted>
                  {/* Lo que se deja de poder cobrar sin ella: es el vínculo con
                      la billetera, y la razón por la que esto no es un ajuste. */}
                  {c.conceptos.length > 0 && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {c.conceptos.map((k) => t(`admin.concepto_${k}`)).join(" · ")}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <StatusPill
                    tone={TONO[c.origen]}
                    label={t(`admin.keyState_${c.origen}`)}
                  />
                  <ClaveEditor
                    clave={c}
                    onDone={(claves) => setData({ claves })}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
