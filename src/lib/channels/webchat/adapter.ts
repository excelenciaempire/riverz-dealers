import type { ChannelAdapter } from '../types';

/**
 * Chat web — el canal sin API del otro lado.
 *
 * En todos los demás canales `sendText` es el envío: le habla a Meta, a Gmail,
 * a Mercado Libre. Acá no hay a quién hablarle. El destinatario es una pestaña
 * abierta en la tienda, y lo que la alimenta es la fila de `messages`: el
 * widget la lee con `GET /api/widget/messages`.
 *
 * Por eso este adapter no envía nada y devuelve `delivered`. Quien llama
 * —tanto `/api/messages/send` (respuesta humana desde la bandeja) como el
 * runner de IA— inserta el mensaje DESPUÉS de llamarlo, así que con esto los
 * dos caminos funcionan sin una sola rama por canal en ninguno de los dos.
 *
 * `parseWebhook` devuelve vacío porque no hay webhook: el mensaje del visitante
 * entra directo por `ingestInboundEvent` desde la ruta del widget.
 */
export const webchatAdapter: ChannelAdapter = {
  channel: 'webchat',
  label: 'Chat web',
  isConfigured() {
    return true;
  },
  async sendText() {
    return { status: 'delivered' as const };
  },
  async sendMedia() {
    return { status: 'delivered' as const };
  },
  async parseWebhook() {
    return [];
  },
};
