"use client";

import { useEffect, useRef, useState } from "react";
import { Pencil, ThumbsDown, ThumbsUp } from "lucide-react";
import { useT } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";

/**
 * Lo que el equipo opina de una respuesta automática, debajo de la burbuja.
 *
 * 👍/👎 y una nota ("qué debería haber respondido"). Se guarda con el tramo de
 * la conversación y se convierte en mejoras del asistente (Asistente IA →
 * Feedback). Sólo aparece en lo que mandó Riverz solo.
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
  const voto = opinion?.voto ?? null;
  const nota = opinion?.nota ?? "";

  useEffect(() => {
    if (editando) campo.current?.focus();
  }, [editando]);

  const guardar = () => {
    setEditando(false);
    if (borrador.trim() !== nota) onCambio({ voto, nota: borrador.trim() });
  };

  return (
    <div className="mt-1 flex max-w-[85%] flex-col items-end gap-1">
      <div
        className={cn(
          "flex items-center gap-0.5 transition-opacity",
          voto || nota ? "opacity-100" : "opacity-40 hover:opacity-100 focus-within:opacity-100",
        )}
      >
        <button
          type="button"
          aria-label={t("inbox.opinionBien")}
          title={t("inbox.opinionBien")}
          onClick={() => onCambio({ voto: voto === "bien" ? null : "bien", nota })}
          className={cn(
            "grid size-6 place-items-center rounded-full hover:bg-muted",
            voto === "bien" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
          )}
        >
          <ThumbsUp className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label={t("inbox.opinionMal")}
          title={t("inbox.opinionMal")}
          onClick={() => {
            const siguiente = voto === "mal" ? null : "mal";
            onCambio({ voto: siguiente, nota });
            if (siguiente === "mal" && !nota) {
              setBorrador("");
              setEditando(true);
            }
          }}
          className={cn(
            "grid size-6 place-items-center rounded-full hover:bg-muted",
            voto === "mal" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          <ThumbsDown className="size-3.5" />
        </button>
        {!editando ? (
          <button
            type="button"
            aria-label={t("inbox.opinionComentar")}
            title={t("inbox.opinionComentar")}
            onClick={() => {
              setBorrador(nota);
              setEditando(true);
            }}
            className="grid size-6 place-items-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <Pencil className="size-3.5" />
          </button>
        ) : null}
      </div>
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
          onClick={() => {
            setBorrador(nota);
            setEditando(true);
          }}
          className="max-w-72 rounded-md bg-amber-500/10 px-2 py-1 text-left text-xs whitespace-pre-wrap break-words text-foreground"
        >
          {nota}
        </button>
      ) : null}
    </div>
  );
}
