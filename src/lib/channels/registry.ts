import type { Channel } from "@/types";
import type { ChannelAdapter } from "./types";
import { marcarParaCanal } from "@/lib/marketing/enlaces";
import { whatsappAdapter } from "./whatsapp/adapter";
import { instagramAdapter } from "./instagram/adapter";
import { messengerAdapter } from "./messenger/adapter";
import { gmailAdapter } from "./gmail/adapter";
import { outlookAdapter } from "./outlook/adapter";
import { zohoAdapter } from "./zoho/adapter";
import { fbCommentAdapter } from "./fb_comment/adapter";
import { igCommentAdapter } from "./ig_comment/adapter";
import { mercadoLibreAdapter } from "./mercadolibre/adapter";
import { tikTokCommentAdapter } from "./tiktok_comment/adapter";
import { voiceAdapter } from "./voice/adapter";
import { webchatAdapter } from "./webchat/adapter";
import { assertConnectionCanSend } from "./send-guard";

const ADAPTERS: Record<Channel, ChannelAdapter> = {
  whatsapp: whatsappAdapter,
  instagram: instagramAdapter,
  messenger: messengerAdapter,
  gmail: gmailAdapter,
  outlook: outlookAdapter,
  zoho: zohoAdapter,
  fb_comment: fbCommentAdapter,
  ig_comment: igCommentAdapter,
  mercadolibre: mercadoLibreAdapter,
  tiktok_comment: tikTokCommentAdapter,
  voice: voiceAdapter,
  webchat: webchatAdapter,
};

export function getAdapter(channel: Channel): ChannelAdapter {
  const adapter = ADAPTERS[channel];
  if (!adapter) throw new Error(`No adapter registered for channel "${channel}"`);

  // Red de seguridad: si manana aparece un camino de envio que no marca sus
  // links en el origen, el cliente igual los recibe marcados.
  //
  // No alcanza por si sola, y ese fue el error de la primera version: el chat
  // web IGNORA el texto que recibe aca —el mensaje lo inserta quien llama— asi
  // que marcar solo en el adaptador lo dejaba sin marca, y en los demas canales
  // la bandeja guardaba un texto distinto del que le llego al cliente. Por eso
  // se marca tambien donde se compone. Marcar dos veces no cambia nada.
  const guarded = {
    ...adapter,
    sendText: async (input: Parameters<typeof adapter.sendText>[0]) => {
      assertConnectionCanSend(input.connection);
      return adapter.sendText({
        ...input,
        text: marcarParaCanal(input.text, channel),
      });
    },
  };
  if (adapter.sendMedia) {
    guarded.sendMedia = async (input) => {
      assertConnectionCanSend(input.connection);
      return adapter.sendMedia!(input);
    };
  }
  if (adapter.sendTemplate) {
    guarded.sendTemplate = async (input) => {
      assertConnectionCanSend(input.connection);
      return adapter.sendTemplate!(input);
    };
  }
  return guarded;
}

export function listAdapters(): ChannelAdapter[] {
  return Object.values(ADAPTERS);
}
