import type { Channel } from "@/types";
import type { ChannelAdapter } from "./types";
import { marcarEnlaces, type Medio } from "@/lib/marketing/enlaces";
import { whatsappAdapter } from "./whatsapp/adapter";
import { instagramAdapter } from "./instagram/adapter";
import { messengerAdapter } from "./messenger/adapter";
import { gmailAdapter } from "./gmail/adapter";
import { outlookAdapter } from "./outlook/adapter";
import { fbCommentAdapter } from "./fb_comment/adapter";
import { igCommentAdapter } from "./ig_comment/adapter";
import { mercadoLibreAdapter } from "./mercadolibre/adapter";
import { tikTokCommentAdapter } from "./tiktok_comment/adapter";
import { voiceAdapter } from "./voice/adapter";
import { webchatAdapter } from "./webchat/adapter";

const ADAPTERS: Record<Channel, ChannelAdapter> = {
  whatsapp: whatsappAdapter,
  instagram: instagramAdapter,
  messenger: messengerAdapter,
  gmail: gmailAdapter,
  outlook: outlookAdapter,
  fb_comment: fbCommentAdapter,
  ig_comment: igCommentAdapter,
  mercadolibre: mercadoLibreAdapter,
  tiktok_comment: tikTokCommentAdapter,
  voice: voiceAdapter,
  webchat: webchatAdapter,
};

/**
 * De qué canal viene cada medio, para marcar los links que salen.
 *
 * Los canales que no venden por link (los comentarios, la voz) no están: no
 * hay nada que marcar en un comentario público, y un `?riverz=` a la vista de
 * todos es ruido.
 */
const MEDIO_DEL_CANAL: Partial<Record<Channel, Medio>> = {
  whatsapp: "whatsapp",
  instagram: "instagram",
  messenger: "messenger",
  webchat: "webchat",
  gmail: "email",
  outlook: "email",
  mercadolibre: "mercadolibre",
};

export function getAdapter(channel: Channel): ChannelAdapter {
  const adapter = ADAPTERS[channel];
  if (!adapter) throw new Error(`No adapter registered for channel "${channel}"`);
  const medio = MEDIO_DEL_CANAL[channel];
  if (!medio) return adapter;

  // Todo link que Riverz manda sale marcado, venga del asistente, de una
  // automatización o de una persona escribiendo en la bandeja.
  //
  // Se envuelve acá, en el registro, y no en cada lugar que arma un mensaje:
  // hay más de una docena de esos y el que se olvide es una venta que después
  // no se puede probar. Éste es el único punto por el que pasan todos.
  return {
    ...adapter,
    sendText: (input) =>
      adapter.sendText({ ...input, text: marcarEnlaces(input.text, { medio }) }),
  };
}

export function listAdapters(): ChannelAdapter[] {
  return Object.values(ADAPTERS);
}
