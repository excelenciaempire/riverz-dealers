"use client";

import type { Channel } from "@/types";
import { CHANNEL_DISPLAY } from "@/lib/channels/display";
import { cn } from "@/lib/utils";
import { Inbox, Megaphone } from "lucide-react";

export type AdsFilter = "off" | "only";

interface ChannelFilterProps {
  /** Currently-selected channel, or null for "all channels". */
  value: Channel | null;
  onChange: (channel: Channel | null) => void;
  /** Channels with at least one connected account in this workspace —
   * other channels render disabled so the inbox doesn't dangle empty
   * filters in front of the user. */
  available: Set<Channel>;
  /** Per-channel unread counts so chips can show a hint dot. */
  unread?: Partial<Record<Channel | "all", number>>;
  /** "only" hides everything except conversations where a message has
   * comments_meta.is_ad = true. Toggled by the Ads chip. */
  adsFilter?: AdsFilter;
  onAdsFilterChange?: (next: AdsFilter) => void;
  /** Count of unread conversations that match the Ads-only filter,
   * shown next to the Ads chip. */
  adsUnreadCount?: number;
}

export function ChannelFilter({
  value,
  onChange,
  available,
  unread,
  adsFilter = "off",
  onAdsFilterChange,
  adsUnreadCount,
}: ChannelFilterProps) {
  const totalUnread = unread?.all ?? 0;
  return (
    <div className="flex flex-nowrap items-center gap-1.5 overflow-x-auto px-3 pb-3 pt-1">
      <Chip
        label="Todos"
        icon={<Inbox className="h-3 w-3" />}
        active={value === null && adsFilter === "off"}
        onClick={() => {
          onChange(null);
          onAdsFilterChange?.("off");
        }}
        count={totalUnread}
      />
      {/* Ads-only chip — sits next to All because business.facebook.com
          treats this as a top-level mode rather than a per-channel filter. */}
      {onAdsFilterChange && (
        <Chip
          label="Anuncios"
          icon={<Megaphone className="h-3 w-3" />}
          tone="#f59e0b"
          active={adsFilter === "only"}
          onClick={() => onAdsFilterChange(adsFilter === "only" ? "off" : "only")}
          count={adsUnreadCount}
        />
      )}
      {Object.values(CHANNEL_DISPLAY).map((d) => {
        const enabled = available.has(d.channel);
        return (
          <Chip
            key={d.channel}
            label={d.shortLabel}
            tone={d.accent}
            disabled={!enabled}
            active={value === d.channel && adsFilter === "off"}
            onClick={() => {
              onChange(d.channel);
              onAdsFilterChange?.("off");
            }}
            count={unread?.[d.channel] ?? 0}
          />
        );
      })}
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
      className={cn(
        "group relative inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-all",
        active
          ? "border-primary/60 bg-primary/15 text-primary"
          : "border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700 hover:text-slate-200",
        disabled && "cursor-not-allowed opacity-40 hover:border-slate-800 hover:text-slate-400",
      )}
      style={!active && tone ? { boxShadow: `inset 2px 0 0 ${tone}55` } : undefined}
    >
      {icon}
      <span className="uppercase tracking-wider">{label}</span>
      {count && count > 0 ? (
        <span
          className={cn(
            "ml-0.5 rounded-full px-1 text-[9px] font-bold tabular-nums",
            active ? "bg-primary/30 text-primary" : "bg-slate-800 text-slate-300",
          )}
        >
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </button>
  );
}
