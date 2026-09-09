"use client";

import type { Channel, Conversation } from "@/types";
import { cn } from "@/lib/utils";
import { MessageSquare, MessageSquareReply, ToggleLeft, ToggleRight } from "lucide-react";
import { useT } from "@/hooks/use-locale";

export type InboxTab = "messages" | "comments" | "all";

export const MESSAGE_CHANNELS: Channel[] = [
  "whatsapp",
  "instagram",
  "messenger",
  "gmail",
  "outlook",
  "zoho",
  "mercadolibre",
  "webchat",
];
export const COMMENT_CHANNELS: Channel[] = ["fb_comment", "ig_comment", "tiktok_comment"];

/**
 * Channels whose filter chip belongs in the current inbox mode.
 *
 * Zoho is personal like Gmail/Outlook, but unlike the long-standing filters
 * it should only appear after this user connects it. Its conversations remain
 * part of the Messages tab even after disconnecting, so historical mail stays
 * readable through "All channels" without advertising a dead connection.
 */
export function visibleChannelsForTab(
  tab: InboxTab,
  connectedChannels: ReadonlySet<Channel>,
): Channel[] {
  const channels =
    tab === "all"
      ? [...MESSAGE_CHANNELS, ...COMMENT_CHANNELS]
      : tab === "comments"
        ? COMMENT_CHANNELS
        : MESSAGE_CHANNELS;
  return channels.filter(
    (channel) => channel !== "zoho" || connectedChannels.has("zoho"),
  );
}

export function channelBelongsToTab(channel: Channel, tab: InboxTab): boolean {
  if (tab === "all")
    return MESSAGE_CHANNELS.includes(channel) || COMMENT_CHANNELS.includes(channel);
  if (tab === "comments") return COMMENT_CHANNELS.includes(channel);
  return MESSAGE_CHANNELS.includes(channel);
}

/**
 * ¿Nació este hilo de una historia? Contestar tu historia o mencionarte en la
 * suya llega por el webhook de mensajes, así que ES un DM y ahí se queda —
 * pero no es una consulta fría, y en la lista tiene que notarse.
 */
export function isStoryConversation(c: Conversation): boolean {
  return (
    c.engagement_kind === "story_reply" || c.engagement_kind === "story_mention"
  );
}

interface InboxTabsProps {
  value: InboxTab;
  onChange: (tab: InboxTab) => void;
  counts: { messages: number; comments: number };
}

/**
 * Top-level inbox split: messages vs comments. Sits above the channel
 * chips so users see the right slice of the unified inbox at a glance
 * without having to enumerate every channel filter every time they
 * want to triage comments.
 *
 * Counts shown next to each tab are unread counts within that slice.
 */
export function InboxTabs({ value, onChange, counts }: InboxTabsProps) {
  const t = useT();
  const unified = value === "all";
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] items-stretch overflow-hidden border-b border-border bg-background/40">
      {/* Toggle "Unificar" PRIMERO, estilo interruptor on/off: junta mensajes y
          comentarios en una sola lista. En móvil se muestra solo el switch
          (sin label) para que los dos tabs conserven su espacio. */}
      <button
        onClick={() => onChange(unified ? "messages" : "all")}
        title={t("inbox.tabUnify")}
        aria-pressed={unified}
        aria-label={t("inbox.tabUnify")}
        className={cn(
          "flex min-w-0 max-w-28 items-center gap-1.5 border-r border-border px-2.5 text-xs font-medium transition-colors sm:px-3",
          unified
            ? "bg-primary/15 text-accent-ink"
            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
        )}
      >
        {unified ? (
          <ToggleRight className="h-4 w-4 shrink-0 text-accent-ink" />
        ) : (
          <ToggleLeft className="h-4 w-4 shrink-0" />
        )}
        <span className="hidden min-w-0 truncate sm:inline">{t("inbox.tabUnify")}</span>
      </button>
      {/* Con el modo unificado activo los dos tabs se atenúan: la lista muestra
          mensajes y comentarios juntos, así que separar por tab no aplica. */}
      <Tab
        active={value === "messages"}
        dimmed={unified}
        onClick={() => onChange("messages")}
        label={t("inbox.tabMessages")}
        icon={<MessageSquare className="h-3.5 w-3.5" />}
        count={counts.messages}
      />
      <Tab
        active={value === "comments"}
        dimmed={unified}
        onClick={() => onChange("comments")}
        label={t("inbox.tabComments")}
        icon={<MessageSquareReply className="h-3.5 w-3.5" />}
        count={counts.comments}
      />
    </div>
  );
}

function Tab({
  active,
  dimmed = false,
  onClick,
  label,
  icon,
  count,
}: {
  active: boolean;
  dimmed?: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex min-w-0 items-center justify-center gap-1 overflow-hidden px-1.5 py-2.5 text-xs font-medium transition-colors sm:px-2",
        active
          ? "text-foreground"
          : dimmed
            ? "text-muted-foreground/50 hover:bg-accent/50 hover:text-foreground"
            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      {icon}
      <span className="min-w-0 truncate">{label}</span>
      {count > 0 && (
        <span className="ml-0.5 shrink-0 rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-accent-ink">
          {count > 999 ? "999+" : count}
        </span>
      )}
      {active && (
        <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-t-full bg-primary" />
      )}
    </button>
  );
}
