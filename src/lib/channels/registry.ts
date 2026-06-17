import type { Channel } from "@/types";
import type { ChannelAdapter } from "./types";
import { whatsappAdapter } from "./whatsapp/adapter";
import { instagramAdapter } from "./instagram/adapter";
import { messengerAdapter } from "./messenger/adapter";
import { gmailAdapter } from "./gmail/adapter";
import { outlookAdapter } from "./outlook/adapter";
import { fbCommentAdapter } from "./fb_comment/adapter";
import { igCommentAdapter } from "./ig_comment/adapter";

const ADAPTERS: Record<Channel, ChannelAdapter> = {
  whatsapp: whatsappAdapter,
  instagram: instagramAdapter,
  messenger: messengerAdapter,
  gmail: gmailAdapter,
  outlook: outlookAdapter,
  fb_comment: fbCommentAdapter,
  ig_comment: igCommentAdapter,
};

export function getAdapter(channel: Channel): ChannelAdapter {
  const adapter = ADAPTERS[channel];
  if (!adapter) throw new Error(`No adapter registered for channel "${channel}"`);
  return adapter;
}

export function listAdapters(): ChannelAdapter[] {
  return Object.values(ADAPTERS);
}
