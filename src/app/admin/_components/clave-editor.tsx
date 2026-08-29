"use client";

import { useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/hooks/use-locale";
import { useFetchWithCsrf } from "@/lib/api/fetch-with-csrf";
import type { EstadoDeClave } from "@/lib/admin/claves";
import { cn } from "@/lib/utils";

/**
 * Cargar, cambiar o quitar la llave global de un proveedor.
 *
 * Estas llaves no son configuración: son el insumo que se revende. Con ellas
 * trabajan todos los comercios y su consumo se le cobra al saldo de cada uno,
 * así que el editor dice **qué se deja de poder cobrar** si la llave falta —
 * sin Fish no hay voz, sin Deepgram no hay transcripción, y una tarifa cuyo
 * proveedor está caído es una tarifa que no se puede facturar.
 *
 * Dos cosas que no hace a propósito:
 *
 *  - **No muestra la llave.** Ni al cargarla ni después: del servidor sólo baja
 *    la pista (`sk-ant-…7f2a`), que alcanza para reconocerla y no para usarla.
 *  - **Quitar no apaga.** Devuelve el proveedor a la variable de Render, y por
 *    eso el estado de arriba dice de dónde sale la que está activa: borrar sin
 *    saber que abajo hay otra sería la peor sorpresa de esta pantalla.
 */
export function ClaveEditor({
  clave,
  onDone,
}: {
  clave: EstadoDeClave;
  onDone: (claves: EstadoDeClave[]) => void;
}) {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [abierto, setAbierto] = useState(false);
  const [valor, setValor] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function enviar(quitar: boolean) {
    setEnviando(true);
    try {
      const res = await fetchWithCsrf("/api/admin/claves", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proveedor: clave.id,
          clave: quitar ? "" : valor.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? t("admin.keyError"));
        return;
      }
      onDone(json.claves as EstadoDeClave[]);
      setValor("");
      setAbierto(false);
      toast.success(t(quitar ? "admin.keyRemoved" : "admin.keySaved"));
    } catch {
      toast.error(t("admin.keyError"));
    } finally {
      setEnviando(false);
    }
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        title={t("admin.keyEdit")}
        aria-label={`${t("admin.keyEdit")} — ${clave.nombre}`}
        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
      >
        <KeyRound className="size-3.5" />
        <span className="tabular-nums">{clave.pista ?? t("admin.keyMissing")}</span>
      </button>
    );
  }

  return (
    <div className="w-full space-y-2 rounded-lg border border-border bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">
        {t("admin.keyOrigin", { v: t(`admin.keyOrigin_${clave.origen}`) })}
        {clave.origen === "panel" && ` · ${clave.envVar}`}
      </p>

      {/* Lo que se deja de poder cobrar sin esta llave. Es el vinculo con la
          billetera: la tarifa existe, pero si el proveedor no responde no hay
          nada que facturar. */}
      {clave.conceptos.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t("admin.keyBilling")}:{" "}
          <span className="text-foreground">
            {clave.conceptos.map((c) => t(`admin.concepto_${c}`)).join(" · ")}
          </span>
        </p>
      )}

      <input
        type="password"
        autoComplete="off"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        placeholder={t("admin.keyPlaceholder")}
        className="w-full rounded-lg border border-border bg-background px-3 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary"
      />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={enviando || !valor.trim()}
          onClick={() => enviar(false)}
          className={cn(
            "rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity",
            (enviando || !valor.trim()) && "opacity-50",
          )}
        >
          {enviando ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            t("admin.keySave")
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            setAbierto(false);
            setValor("");
          }}
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          {t("common.cancel")}
        </button>
        {/* Sólo se puede quitar lo que se cargó acá: la variable de Render no
            se toca desde el panel. */}
        {clave.origen === "panel" && (
          <button
            type="button"
            disabled={enviando}
            onClick={() => enviar(true)}
            className="ml-auto rounded-lg border border-red-600/40 px-3 py-1.5 text-xs text-red-600 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
          >
            {t("admin.keyRemove")}
          </button>
        )}
      </div>
    </div>
  );
}
