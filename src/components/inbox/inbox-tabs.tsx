"use client";

import type { Channel } from "@/types";
import { cn } from "@/lib/utils";
import { MessageSquare, MessageSquareReply } from "lucide-react";
import { useT } from "@/hooks/use-locale";

export type InboxTab = "messages" | "comments";

export const MESSAGE_CHANNELS: Channel[] = [
  "whatsapp",
  "instagram",
  "messenger",
  "gmail",
  "outlook",
  "mercadolibre",
];
export const COMMENT_CHANNELS: Channel[] = ["fb_comment", "ig_comment"];

export function channelBelongsToTab(channel: Channel, tab: InboxTab): boolean {
  if (tab === "comments") return COMMENT_CHANNELS.includes(channel);
  return MESSAGE_CHANNELS.includes(channel);
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
  return (
    <div className="flex border-b border-border bg-background/40">
      <Tab
        active={value === "messages"}
        onClick={() => onChange("messages")}
        label={t("inbox.tabMessages")}
        icon={<MessageSquare className="h-3.5 w-3.5" />}
        count={counts.messages}
      />
      <Tab
        active={value === "comments"}
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
  onClick,
  label,
  icon,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex flex-1 items-center justify-center gap-1.5 px-2 py-2.5 text-xs font-medium transition-colors",
        active
          ? "text-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      {icon}
      <span>{label}</span>
      {count > 0 && (
        <span className="ml-0.5 rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-accent-ink">
          {count > 999 ? "999+" : count}
        </span>
      )}
      {active && (
        <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-t-full bg-primary" />
      )}
    </button>
  );
}
