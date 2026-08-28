"use client";

import type { Channel } from "@/types";
import { Globe, Star } from "lucide-react";
import { mlThreadKind, type MlThreadKind } from "@/lib/channels/display";
import { useT } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";

/**
 * Qué es este hilo de Mercado Libre. Las tres cosas llegan al mismo sitio y se
 * parecen lo bastante como para confundirse, pero piden cosas distintas:
 *
 *   Pregunta — pre-venta y PÚBLICA en la publicación. Lo que se conteste queda
 *              a la vista de cualquiera que mire el producto (de ahí el globo),
 *              y Mercado Libre penaliza la demora.
 *   Mensaje  — post-venta, privado y atado a un pedido.
 *   Opinión  — ya compró y ya opinó. NO se puede contestar: Mercado Libre no
 *              expone endpoint para hacerlo. Se lee.
 *
 * No renderiza nada fuera de Mercado Libre. `variant="header"` usa la etiqueta
 * larga dentro del hilo abierto —donde se responde y el matiz público/privado
 * pesa más—; la fila de la lista usa la corta.
 */

const LABELS: Record<MlThreadKind, { row: string; header: string }> = {
  question: { row: "inbox.mlQuestion", header: "inbox.mlQuestionPublic" },
  message: { row: "inbox.mlMessage", header: "inbox.mlMessagePostSale" },
  review: { row: "inbox.mlReview", header: "inbox.mlReviewPublic" },
};

const TONES: Record<MlThreadKind, string> = {
  question: "bg-sky-400/10 text-sky-700 dark:text-sky-300 ring-1 ring-sky-400/30",
  message: "bg-amber-400/10 text-amber-700 dark:text-amber-300 ring-1 ring-amber-400/30",
  review: "bg-violet-400/10 text-violet-700 dark:text-violet-300 ring-1 ring-violet-400/30",
};

export function MlKindBadge({
  channel,
  threadExternalId,
  variant = "row",
  className,
}: {
  channel: Channel;
  threadExternalId?: string | null;
  variant?: "row" | "header";
  className?: string;
}) {
  const t = useT();
  const kind = mlThreadKind(channel, threadExternalId);
  if (!kind) return null;

  const label = t(LABELS[kind][variant === "header" ? "header" : "row"]);

  return (
    <span
      title={label}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        TONES[kind],
        className,
      )}
    >
      {kind === "question" && <Globe className="h-2.5 w-2.5" />}
      {kind === "review" && <Star className="h-2.5 w-2.5" />}
      {label}
    </span>
  );
}
