"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useT } from "@/hooks/use-locale";
import { useFormat } from "@/hooks/use-format";
import { useFetchWithCsrf } from "@/lib/api/fetch-with-csrf";

/**
 * El motor de una cuenta, en un botón.
 *
 * Apagado, no sale ni un mensaje: ni respuesta del agente, ni automatización,
 * ni difusión, ni llamada. Encendido, la cuenta opera.
 *
 * Es el hermano del interruptor de suspensión que está justo al lado, y la
 * diferencia importa: suspender además le cierra el panel al comercio, y eso
 * está bien para quien no paga. El motor lo deja entrar — es el estado en el
 * que mira lo que le montamos y lo aprueba. Cerrarle el panel ahí sería
 * dejarlo afuera de la pantalla donde tiene que decir que sí.
 *
 * No pide motivo: apagar el motor es reversible en un clic y no le corta el
 * acceso a nadie. Quién lo apagó queda en la auditoría igual.
 */
export function MotorSwitch({
  workspaceId,
  motorApagadoAt,
  onDone,
}: {
  workspaceId: string;
  motorApagadoAt: string | null;
  onDone: () => void;
}) {
  const t = useT();
  const format = useFormat();
  const fetchWithCsrf = useFetchWithCsrf();
  const [enviando, setEnviando] = useState(false);
  const apagado = Boolean(motorApagadoAt);

  async function cambiar(encendido: boolean) {
    setEnviando(true);
    try {
      const res = await fetchWithCsrf(
        `/api/admin/workspaces/${workspaceId}/motor`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ encendido }),
        },
      );
      if (!res.ok) throw new Error(String(res.status));
      toast.success(encendido ? t("admin.motorOnDone") : t("admin.motorOffDone"));
      onDone();
    } catch {
      toast.error(t("admin.motorError"));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-3 px-4 py-3.5">
      <p className="text-sm text-foreground">
        {apagado
          ? t("admin.motorOffSince", {
              date: format.dateTime(motorApagadoAt as string),
            })
          : t("admin.motorOn")}
      </p>

      <button
        type="button"
        disabled={enviando}
        onClick={() => cambiar(apagado)}
        className={
          apagado
            ? "rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            : "rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted/50 disabled:opacity-50"
        }
      >
        {apagado ? t("admin.motorOnCta") : t("admin.motorOffCta")}
      </button>

      <p className="text-[11px] leading-snug text-muted-foreground">
        {t("admin.motorHint")}
      </p>
    </div>
  );
}
