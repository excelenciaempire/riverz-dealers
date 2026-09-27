"use client";

import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { useT } from "@/hooks/use-locale";

/**
 * Lo que el equipo opina de una respuesta automática, debajo de la burbuja.
 *
 * Una nota ("qué debería haber respondido"); sin 👍/👎, que no dicen qué cambiar. Se guarda con el tramo de
 * la conversación y se convierte en mejoras del asistente (Asistente IA →
 * Feedback). Un control al final de cada grupo de respuestas del equipo/Riverz.
 */

export interface OpinionIa {
  voto: "bien" | "mal" | null;
  nota: string;
}

export function OpinionIaControl({
  opinion,
  onCambio,
}: {
  opinion: OpinionIa | null;
  onCambio: (o: OpinionIa) => void;
}) {
  const t = useT();
  const [editando, setEditando] = useState(false);
  const [borrador, setBorrador] = useState("");
  const campo = useRef<HTMLTextAreaElement | null>(null);
  const nota = opinion?.nota ?? "";

  useEffect(() => {
    if (editando) campo.current?.focus();
  }, [editando]);

  const guardar = () => {
    setEditando(false);
    if (borrador.trim() !== nota) onCambio({ voto: null, nota: borrador.trim() });
  };
  const abrir = () => {
    setBorrador(nota);
    setEditando(true);
  };

  return (
    <div className="mt-1 flex max-w-[85%] flex-col items-end gap-1">
      {editando ? (
        <div className="w-72 max-w-full space-y-1">
          <textarea
            ref={campo}
            value={borrador}
            rows={2}
            maxLength={1000}
            onChange={(e) => setBorrador(e.target.value)}
            onBlur={guardar}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                guardar();
              }
              if (e.key === "Escape") setEditando(false);
            }}
            placeholder={t("inbox.opinionPlaceholder")}
            className="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-base outline-none focus:border-primary sm:text-xs"
          />
          <p className="text-[10px] text-muted-foreground">{t("inbox.opinionAviso")}</p>
        </div>
      ) : nota ? (
        <button
          type="button"
          onClick={abrir}
          className="max-w-72 rounded-md bg-amber-500/10 px-2 py-1 text-left text-xs whitespace-pre-wrap break-words text-foreground"
        >
          {nota}
        </button>
      ) : (
        <button
          type="button"
          onClick={abrir}
          className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] text-muted-foreground opacity-60 hover:bg-muted hover:opacity-100 focus-visible:opacity-100"
        >
          <Pencil className="size-3" />
          {t("inbox.opinionComentar")}
        </button>
      )}
    </div>
  );
}
