/**
 * Shared status badge config for broadcasts + recipients.
 *
 * Previously `statusConfig` was defined inline in both
 * /broadcasts/page.tsx and /broadcasts/[id]/page.tsx with slight
 * drift risk. One source of truth now.
 *
 * Dark-theme only — bg-*-500/10 + text-*-400 + border-*-500/20.
 */

import type { BroadcastStatus, RecipientStatus } from "@/types";

export interface StatusDisplay {
  label: string;
  classes: string;
  /**
   * Set true for statuses that should pulse in the UI to convey
   * "live / in-flight" — currently only `sending`.
   */
  pulse?: boolean;
}

/**
 * Paleta minimalista: solo coloreamos los estados que el comerciante
 * necesita reconocer de un vistazo (éxito = verde sutil, error = rojo
 * sutil, en vuelo = ámbar sutil). El resto queda neutro para no
 * inundar la tabla de pastillas multicolor.
 */
export const broadcastStatusConfig: Record<BroadcastStatus, StatusDisplay> = {
  draft: {
    label: "Borrador",
    classes: "border-border bg-muted text-muted-foreground",
  },
  scheduled: {
    label: "Programada",
    classes: "border-border bg-muted text-foreground",
  },
  sending: {
    label: "Enviando",
    classes:
      "border-amber-600/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    pulse: true,
  },
  sent: {
    label: "Enviada",
    classes:
      "border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  failed: {
    label: "Fallida",
    classes:
      "border-red-600/30 bg-red-500/10 text-red-600 dark:text-red-400",
  },
};

export const recipientStatusConfig: Record<RecipientStatus, StatusDisplay> = {
  pending: {
    label: "Pendiente",
    classes: "border-border bg-muted text-muted-foreground",
  },
  sent: {
    label: "Enviado",
    classes: "border-border bg-muted text-foreground",
  },
  delivered: {
    label: "Entregado",
    classes:
      "border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  read: {
    label: "Leído",
    classes:
      "border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  replied: {
    label: "Respondido",
    classes: "border-border bg-muted text-foreground",
  },
  failed: {
    label: "Fallido",
    classes:
      "border-red-600/30 bg-red-500/10 text-red-600 dark:text-red-400",
  },
};

/**
 * Tolerant lookup — callers often have a generic string status
 * coming from Supabase. Falls back to the "draft" / "pending"
 * entry so the UI never crashes on an unknown value.
 */
export function getBroadcastStatus(status: string): StatusDisplay {
  return (
    broadcastStatusConfig[status as BroadcastStatus] ??
    broadcastStatusConfig.draft
  );
}

export function getRecipientStatus(status: string): StatusDisplay {
  return (
    recipientStatusConfig[status as RecipientStatus] ??
    recipientStatusConfig.pending
  );
}
