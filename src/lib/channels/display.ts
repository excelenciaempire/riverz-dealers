import type { Channel } from "@/types";

export interface ChannelDisplay {
  channel: Channel;
  label: string;
  shortLabel: string;
  /** Tailwind colour class for badges (text + bg + ring). */
  badge: string;
  /** A single tone used for hue accents. */
  accent: string;
  /** True if this channel can only be replied to (no proactive send). */
  replyOnly?: boolean;
}

export const CHANNEL_DISPLAY: Record<Channel, ChannelDisplay> = {
  whatsapp: {
    channel: "whatsapp",
    label: "WhatsApp",
    shortLabel: "WA",
    badge: "bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/30",
    accent: "#25D366",
  },
  instagram: {
    channel: "instagram",
    label: "Instagram",
    shortLabel: "IG",
    badge: "bg-fuchsia-500/10 text-fuchsia-300 ring-1 ring-fuchsia-500/30",
    accent: "#E1306C",
  },
  messenger: {
    channel: "messenger",
    label: "Messenger",
    shortLabel: "MS",
    badge: "bg-sky-500/10 text-sky-300 ring-1 ring-sky-500/30",
    accent: "#0084FF",
  },
  gmail: {
    channel: "gmail",
    label: "Gmail",
    shortLabel: "GM",
    badge: "bg-red-500/10 text-red-300 ring-1 ring-red-500/30",
    accent: "#EA4335",
  },
  outlook: {
    channel: "outlook",
    label: "Outlook",
    shortLabel: "OL",
    badge: "bg-blue-500/10 text-blue-300 ring-1 ring-blue-500/30",
    accent: "#0078D4",
  },
  fb_comment: {
    channel: "fb_comment",
    label: "Comentarios FB",
    shortLabel: "FB",
    badge: "bg-indigo-500/10 text-indigo-300 ring-1 ring-indigo-500/30",
    accent: "#1877F2",
    replyOnly: true,
  },
  ig_comment: {
    channel: "ig_comment",
    label: "Comentarios IG",
    shortLabel: "IG·",
    badge: "bg-pink-500/10 text-pink-300 ring-1 ring-pink-500/30",
    accent: "#C13584",
    replyOnly: true,
  },
};

export function channelDisplay(channel: Channel): ChannelDisplay {
  return CHANNEL_DISPLAY[channel];
}

import type { TFn } from "@/lib/i18n/translate";

/**
 * Locale-aware channel label for USER-FACING UI. Brand names (WhatsApp,
 * Instagram, Messenger, Gmail, Outlook) are returned as-is; only the
 * non-brand comment labels are translated. Backend/log uses can keep using
 * channelDisplay(channel).label directly.
 */
export function channelLabel(channel: Channel, t: TFn): string {
  if (channel === "fb_comment") return t("common.channelFbComments");
  if (channel === "ig_comment") return t("common.channelIgComments");
  return CHANNEL_DISPLAY[channel].label;
}
