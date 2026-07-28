import Image from "next/image";
import { MessageSquare } from "lucide-react";
import type { Channel } from "@/types";
import { cn } from "@/lib/utils";

/**
 * Renders the official brand logo for a channel. Logos live under
 * /public/channels/ (sourced from Simple Icons, CC0). For comment
 * channels we reuse the parent platform logo (Facebook for fb_comment,
 * Instagram for ig_comment) with a small "·" overlay treatment.
 *
 * Any channel without a brand logo falls back to a lucide MessageSquare
 * rather than pointing at a missing asset.
 */
interface ChannelLogoProps {
  channel: Channel;
  size?: number;
  className?: string;
  /** Override the brand logo with a specific asset (e.g. the Meta logo on
   *  the Facebook group card). Falls back to the channel's mapped logo. */
  src?: string;
  alt?: string;
}

const LOGO_MAP: Partial<Record<Channel, { src: string; alt: string }>> = {
  whatsapp: { src: "/channels/whatsapp.svg", alt: "WhatsApp" },
  instagram: { src: "/channels/instagram.svg", alt: "Instagram" },
  messenger: { src: "/channels/messenger.svg", alt: "Messenger" },
  gmail: { src: "/channels/gmail.svg", alt: "Gmail" },
  outlook: { src: "/channels/microsoftoutlook.svg", alt: "Outlook" },
  fb_comment: { src: "/channels/facebook.svg", alt: "Facebook" },
  ig_comment: { src: "/channels/instagram.svg", alt: "Instagram" },
  mercadolibre: { src: "/channels/mercadolibre.svg", alt: "Mercado Libre" },
  ml_review: { src: "/channels/mercadolibre.svg", alt: "Mercado Libre" },
};

export function ChannelLogo({ channel, size = 20, className, src, alt }: ChannelLogoProps) {
  const mapped = LOGO_MAP[channel];
  const logo = src ? { src, alt: alt ?? mapped?.alt ?? channel } : mapped;
  if (!logo) {
    return (
      <MessageSquare
        width={size}
        height={size}
        className={cn("inline-block text-muted-foreground", className)}
      />
    );
  }
  return (
    <Image
      src={logo.src}
      alt={logo.alt}
      width={size}
      height={size}
      className={cn("inline-block", className)}
    />
  );
}
