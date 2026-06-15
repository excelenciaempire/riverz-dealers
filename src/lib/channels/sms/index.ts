import type {
  ChannelAdapter,
  InboundEvent,
  OutboundText,
  SendResult,
} from "../types";
import type { ChannelConnection } from "@/types";

/**
 * SMS — stub adapter. El canal está reservado en la taxonomía para que
 * el resto del sistema (asignación, reglas, etiquetado, segmentos) pueda
 * referenciarlo, pero la integración real con un gateway (Twilio,
 * MessageBird, etc.) todavía no está implementada. Cualquier intento de
 * enviar arroja "SMS no configurado" y la tarjeta del setup queda como
 * "próximamente".
 */
export const smsAdapter: ChannelAdapter = {
  channel: "sms",
  label: "SMS",

  isConfigured(_connection: ChannelConnection): boolean {
    return false;
  },

  async sendText(_input: OutboundText): Promise<SendResult> {
    throw new Error("SMS no configurado");
  },

  async parseWebhook(
    _req: Request,
    _connection: ChannelConnection,
  ): Promise<InboundEvent[]> {
    throw new Error("SMS no configurado");
  },
};
