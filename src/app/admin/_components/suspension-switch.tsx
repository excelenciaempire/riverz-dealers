"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useT } from "@/hooks/use-locale";
import { useFormat } from "@/hooks/use-format";
import { useFetchWithCsrf } from "@/lib/api/fetch-with-csrf";

/**
 * El interruptor del cobro manual: deja al comercio entrar, o no.
 *
 * Es la única escritura del panel que le cambia la vida al comercio, así
 * que pide confirmación escribiendo antes de cortar y muestra siempre desde
 * cuándo está cortado. El motivo es una nota para el equipo — el comercio
 * ve un cartel neutro, no esto.
 */
export function SuspensionSwitch({
  workspaceId,
  suspendedAt,
  suspendedReason,
  onDone,
}: {
  workspaceId: string;
  suspendedAt: string | null;
  suspendedReason: string | null;
  onDone: () => void;
}) {
  const t = useT();
  const format = useFormat();
  const fetchWithCsrf = useFetchWithCsrf();
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const suspendida = Boolean(suspendedAt);

  async function cambiar(suspender: boolean) {
    setEnviando(true);
    try {
      const res = await fetchWithCsrf(
        `/api/admin/workspaces/${workspaceId}/suspension`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ suspended: suspender, reason: motivo }),
        },
      );
      if (!res.ok) throw new Error(String(res.status));
      toast.success(
        suspender ? t("admin.suspendDone") : t("admin.resumeDone"),
      );
      setMotivo("");
      onDone();
    } catch {
      toast.error(t("admin.suspendError"));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-3 px-4 py-3.5">
      <p className="text-sm text-foreground">
        {suspendida ? t("admin.suspendedSince", {
          date: format.dateTime(suspendedAt as string),
        }) : t("admin.suspendActive")}
      </p>
      {suspendida && suspendedReason && (
        <p className="text-xs text-muted-foreground">{suspendedReason}</p>
      )}

      {!suspendida && (
        <input
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder={t("admin.suspendReasonPlaceholder")}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
        />
      )}

      <button
        type="button"
        disabled={enviando}
        onClick={() => cambiar(!suspendida)}
        className={
          suspendida
            ? "rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            : "rounded-lg border border-red-600/40 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
        }
      >
        {suspendida ? t("admin.resumeCta") : t("admin.suspendCta")}
      </button>

      <p className="text-[11px] leading-snug text-muted-foreground">
        {t("admin.suspendHint")}
      </p>
    </div>
  );
}
