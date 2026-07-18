"use client";

import type { Channel } from "@/types";
import { Globe } from "lucide-react";
import { mlThreadKind } from "@/lib/channels/display";
import { useT } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";

/**
 * Marks a MercadoLibre conversation as a pre-sale QUESTION or a post-sale
 * MESSAGE. The real signal is public vs private: a question is visible to
 * anyone browsing the listing and the answer is published there (hence the
 * globe), while a message is a private post-sale chat tied to an order.
 *
 * Renders nothing for non-ML conversations. `variant="header"` uses the
 * fuller "Pregunta pública" / "Mensaje post-venta" label inside the open
 * thread — where the reply happens and the public/private stake matters
 * most; the list row uses the compact label.
 */
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
  const isQuestion = kind === "question";
  const label = t(
    variant === "header"
      ? isQuestion
        ? "inbox.mlQuestionPublic"
        : "inbox.mlMessagePostSale"
      : isQuestion
        ? "inbox.mlQuestion"
        : "inbox.mlMessage",
  );
  return (
    <span
      title={label}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        isQuestion
          ? "bg-sky-400/10 text-sky-300 ring-1 ring-sky-400/30"
          : "bg-amber-400/10 text-amber-300 ring-1 ring-amber-400/30",
        className,
      )}
    >
      {isQuestion && <Globe className="h-2.5 w-2.5" />}
      {label}
    </span>
  );
}
