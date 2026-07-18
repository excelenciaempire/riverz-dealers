"use client";

import type { MlThreadKind } from "@/lib/channels/display";
import { cn } from "@/lib/utils";
import { useT } from "@/hooks/use-locale";

export type MlKindFilter = "all" | MlThreadKind;

/**
 * Secondary filter shown only when the MercadoLibre channel chip is active.
 * ML conversations split into two very different jobs — pre-sale questions
 * (public, on the listing) and post-sale messages (private, per order) — so
 * this lets the seller focus on one without leaving the unified inbox.
 * Counts are the number of ML conversations of each kind currently loaded.
 */
export function MlSubFilter({
  value,
  onChange,
  counts,
}: {
  value: MlKindFilter;
  onChange: (v: MlKindFilter) => void;
  counts: { question: number; message: number };
}) {
  const t = useT();
  const items: { key: MlKindFilter; label: string; count: number }[] = [
    {
      key: "all",
      label: t("inbox.mlFilterAll"),
      count: counts.question + counts.message,
    },
    {
      key: "question",
      label: t("inbox.mlFilterQuestions"),
      count: counts.question,
    },
    {
      key: "message",
      label: t("inbox.mlFilterMessages"),
      count: counts.message,
    },
  ];
  return (
    <div className="flex items-center gap-1.5 border-b border-border bg-background/40 px-3 pb-2">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          onClick={() => onChange(it.key)}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-all",
            value === it.key
              ? "border-primary/60 bg-primary/15 text-accent-ink"
              : "border-border bg-card text-foreground hover:border-foreground/30",
          )}
        >
          <span>{it.label}</span>
          {it.count > 0 && (
            <span
              className={cn(
                "rounded-full px-1 text-[9px] font-bold tabular-nums",
                value === it.key
                  ? "bg-primary/30 text-accent-ink"
                  : "bg-muted text-foreground",
              )}
            >
              {it.count > 99 ? "99+" : it.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
