"use client";

import type { Channel } from "@/types";
import { CHANNEL_DISPLAY, channelLabel } from "@/lib/channels/display";
import { ChannelLogo } from "@/components/inbox/channel-logo";
import { cn } from "@/lib/utils";
import { Inbox } from "lucide-react";
import { useT } from "@/hooks/use-locale";

interface ChannelFilterProps {
  /** Currently-selected channel, or null for "all channels". */
  value: Channel | null;
  onChange: (channel: Channel | null) => void;
  /** Channels with at least one connected account in this workspace —
   * other channels are simply not rendered so the row stays clean. */
  available: Set<Channel>;
  /** Per-channel unread counts so chips can show a hint dot. */
  unread?: Partial<Record<Channel | "all", number>>;
}

export function ChannelFilter({
  value,
  onChange,
  available,
  unread,
}: ChannelFilterProps) {
  const t = useT();
  const totalUnread = unread?.all ?? 0;
  return (
    <div className="flex flex-nowrap items-center gap-1.5 overflow-x-auto px-3 pb-3 pt-2.5 sm:pt-1">
      <Chip
        label={t("inbox.allChannels")}
        icon={<Inbox className="h-4 w-4 sm:h-3.5 sm:w-3.5" />}
        active={value === null}
        onClick={() => onChange(null)}
        count={totalUnread}
      />
      {Object.values(CHANNEL_DISPLAY)
        // Only render chips for channels the caller marked as available.
        .filter((d) => available.has(d.channel))
        .map((d) => (
          <Chip
            key={d.channel}
            label={channelLabel(d.channel, t)}
            tone={d.accent}
            // Real brand logo instead of two-letter abbreviation —
            // the row is the channel filter, so showing the actual
            // app icons makes the affordance obvious at a glance.
            icon={<ChannelLogo channel={d.channel} size={14} />}
            active={value === d.channel}
            onClick={() => onChange(d.channel)}
            count={unread?.[d.channel] ?? 0}
          />
        ))}
    </div>
  );
}

function Chip({
  label,
  tone,
  icon,
  active,
  disabled,
  count,
  onClick,
}: {
  label: string;
  tone?: string;
  icon?: React.ReactNode;
  active: boolean;
  disabled?: boolean;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "group relative inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all",
        active
          ? "border-primary/60 bg-primary/15 text-accent-ink"
          : "border-border bg-card text-foreground hover:border-foreground/30 hover:text-foreground",
        disabled && "cursor-not-allowed opacity-40 hover:border-border hover:text-muted-foreground",
      )}
      style={!active && tone ? { boxShadow: `inset 2px 0 0 ${tone}55` } : undefined}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
      {count && count > 0 ? (
        <span
          className={cn(
            "ml-0.5 rounded-full px-1 text-[9px] font-bold tabular-nums",
            active ? "bg-primary/30 text-accent-ink" : "bg-muted text-foreground",
          )}
        >
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </button>
  );
}
