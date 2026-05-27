"use client";

import type { Channel } from "@/types";
import { cn } from "@/lib/utils";
import { MessageSquare, MessageSquareReply, AlertCircle } from "lucide-react";

export type InboxTab = "messages" | "comments" | "unassigned";

export const MESSAGE_CHANNELS: Channel[] = [
  "whatsapp",
  "instagram",
  "messenger",
  "gmail",
  "outlook",
];
export const COMMENT_CHANNELS: Channel[] = ["fb_comment", "ig_comment"];

export function channelBelongsToTab(channel: Channel, tab: InboxTab): boolean {
  if (tab === "comments") return COMMENT_CHANNELS.includes(channel);
  if (tab === "messages") return MESSAGE_CHANNELS.includes(channel);
  // 'unassigned' is orthogonal to channel — handled by status filter
  return true;
}

interface InboxTabsProps {
  value: InboxTab;
  onChange: (tab: InboxTab) => void;
  counts: { messages: number; comments: number; unassigned: number };
}

/**
 * Top-level inbox split: messages vs comments vs unassigned. Sits above
 * the channel chips so users see the right slice of the unified inbox
 * at a glance without having to enumerate every channel filter every
 * time they want to triage comments.
 *
 * Counts shown next to each tab are unread counts within that slice.
 */
export function InboxTabs({ value, onChange, counts }: InboxTabsProps) {
  return (
    <div className="flex border-b border-slate-800 bg-slate-950/40">
      <Tab
        active={value === "messages"}
        onClick={() => onChange("messages")}
        label="Mensajes"
        icon={<MessageSquare className="h-3.5 w-3.5" />}
        count={counts.messages}
      />
      <Tab
        active={value === "comments"}
        onClick={() => onChange("comments")}
        label="Comentarios"
        icon={<MessageSquareReply className="h-3.5 w-3.5" />}
        count={counts.comments}
      />
      <Tab
        active={value === "unassigned"}
        onClick={() => onChange("unassigned")}
        label="Sin asignar"
        icon={<AlertCircle className="h-3.5 w-3.5" />}
        count={counts.unassigned}
        tone="warning"
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
  tone = "primary",
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
  count: number;
  tone?: "primary" | "warning";
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex flex-1 items-center justify-center gap-1.5 px-2 py-2.5 text-xs font-medium transition-colors",
        active
          ? "text-white"
          : "text-slate-400 hover:bg-slate-900/50 hover:text-slate-200",
      )}
    >
      {icon}
      <span>{label}</span>
      {count > 0 && (
        <span
          className={cn(
            "ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
            tone === "warning"
              ? "bg-amber-500/20 text-amber-300"
              : "bg-primary/20 text-primary",
          )}
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
      {active && (
        <span
          className={cn(
            "absolute inset-x-2 bottom-0 h-0.5 rounded-t-full",
            tone === "warning" ? "bg-amber-400" : "bg-primary",
          )}
        />
      )}
    </button>
  );
}
