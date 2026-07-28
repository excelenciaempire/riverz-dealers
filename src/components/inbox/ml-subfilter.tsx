"use client";

import type { MlThreadKind } from "@/lib/channels/display";
import { cn } from "@/lib/utils";
import { useT } from "@/hooks/use-locale";

/** `claim` no es un hilo: es el expediente de un reclamo, que se lista aparte
 *  pero se elige desde el mismo sitio porque es donde el vendedor lo busca. */
export type MlKindFilter = "all" | MlThreadKind | "claim";

/**
 * Todo Mercado Libre en un solo mando.
 *
 * Bajo el mismo canal conviven cuatro cosas que piden atención distinta:
 * preguntas pre-venta (públicas, en la publicación), mensajes post-venta
 * (privados, por pedido), opiniones de quien ya compró (públicas y sin
 * respuesta posible) y reclamos (expedientes con reloj, que pegan en la
 * reputación). Esto deja mirar una sola sin salir de la bandeja unificada.
 *
 * Las pastillas ENVUELVEN en vez de desbordar: con cinco no caben en el ancho
 * del panel y una barra de scroll horizontal escondía justo la última, que es
 * la más urgente.
 */
export function MlSubFilter({
  value,
  onChange,
  counts,
}: {
  value: MlKindFilter;
  onChange: (v: MlKindFilter) => void;
  counts: {
    question: number;
    message: number;
    review: number;
    claim: number;
  };
}) {
  const t = useT();
  const items: {
    key: MlKindFilter;
    label: string;
    count: number;
    urgent?: boolean;
  }[] = [
    {
      key: "all",
      label: t("inbox.mlFilterAll"),
      count: counts.question + counts.message + counts.review,
    },
    { key: "question", label: t("inbox.mlFilterQuestions"), count: counts.question },
    { key: "message", label: t("inbox.mlFilterMessages"), count: counts.message },
    { key: "review", label: t("inbox.mlFilterReviews"), count: counts.review },
    {
      key: "claim",
      label: t("inbox.mlFilterClaims"),
      count: counts.claim,
      // Un reclamo abierto corre contra reloj y afecta la reputación del
      // vendedor: cuando hay alguno, la pastilla lo dice sin que haya que
      // entrar a mirar.
      urgent: counts.claim > 0,
    },
  ];

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-background/40 px-3 pb-2.5 pt-2.5">
      {items.map((it) => {
        const active = value === it.key;
        return (
          <button
            key={it.key}
            type="button"
            onClick={() => onChange(it.key)}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-all",
              active
                ? "border-primary/60 bg-primary/15 text-accent-ink"
                : it.urgent
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-600 hover:border-amber-500/60 dark:text-amber-400"
                  : "border-border bg-card text-foreground hover:border-foreground/30",
            )}
          >
            <span>{it.label}</span>
            {it.count > 0 && (
              <span
                className={cn(
                  "rounded-full px-1 text-[9px] font-bold tabular-nums",
                  active
                    ? "bg-primary/30 text-accent-ink"
                    : it.urgent
                      ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
                      : "bg-muted text-foreground",
                )}
              >
                {it.count > 99 ? "99+" : it.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
