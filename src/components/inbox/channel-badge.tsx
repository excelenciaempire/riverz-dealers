import type { Channel } from "@/types";
import { channelDisplay } from "@/lib/channels/display";
import { cn } from "@/lib/utils";

interface ChannelBadgeProps {
  channel: Channel;
  size?: "sm" | "md";
  variant?: "short" | "full";
  className?: string;
}

/**
 * Single source of truth for channel badges across the unified inbox.
 * Renders the channel's tone + short code (WA/IG/MS/…) or its full label.
 */
export function ChannelBadge({
  channel,
  size = "sm",
  variant = "short",
  className,
}: ChannelBadgeProps) {
  const d = channelDisplay(channel);
  return (
    <span
      title={d.label}
      className={cn(
        "inline-flex items-center rounded-full font-semibold uppercase tracking-wider",
        d.badge,
        size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs",
        className,
      )}
    >
      {variant === "short" ? d.shortLabel : d.label}
    </span>
  );
}
