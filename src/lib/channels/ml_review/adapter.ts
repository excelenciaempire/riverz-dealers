import type {
  ChannelAdapter,
  InboundEvent,
  OutboundText,
  ParsedWebhookContext,
  SendResult,
} from "../types";
import type { ChannelConnection } from "@/types";

/**
 * Mercado Libre — opiniones de producto ("Opiniones", las estrellas y el
 * comentario que deja quien compró).
 *
 * Es una superficie de SOLO LECTURA, y no por falta de trabajo: Mercado Libre
 * no expone ningún endpoint para que el vendedor responda una opinión, y las
 * anonimiza (`reviewer_id: 0`), así que tampoco hay a quién escribirle. Lo
 * único que se puede hacer con ellas es verlas — que es justo lo que faltaba.
 *
 * Tampoco hay aviso: la aplicación está suscrita a los 30 temas de
 * notificación que Mercado Libre ofrece y ninguno cubre las opiniones. Por eso
 * entran por el sondeo (`ml_review/poll.ts`), no por webhook.
 *
 * La conexión es la MISMA de `mercadolibre` (mismo vendedor, mismo token). Este
 * canal no se conecta por separado; el sondeo lee las conexiones de Mercado
 * Libre y escribe las opiniones bajo este canal para que caigan en la pestaña
 * de Comentarios en vez de mezclarse con las preguntas.
 */
export const mlReviewAdapter: ChannelAdapter = {
  channel: "ml_review",
  label: "Opiniones ML",

  isConfigured(_connection: ChannelConnection): boolean {
    // Nunca hay una conexión propia de este canal: cuelga de la de Mercado
    // Libre. Declararlo configurado invitaría a la UI a ofrecer un "conectar"
    // que no existe.
    return false;
  },

  async sendText(_input: OutboundText): Promise<SendResult> {
    throw new Error(
      "[ml_review] Mercado Libre no permite responder opiniones por API",
    );
  },

  async parseWebhook(
    _ctx: ParsedWebhookContext,
    _connection: ChannelConnection,
  ): Promise<InboundEvent[]> {
    // Mercado Libre no notifica opiniones. Si algún día publica el tema, este
    // es el lugar; por ahora nada llega por aquí.
    return [];
  },
};
