import type { Channel, Message } from "@/types";

/**
 * ¿Se puede reescribir un mensaje que YA salió?
 *
 * Casi ningún canal lo permite, y no por falta de ganas: no hay API.
 *  - WhatsApp Cloud API: `POST /{phone-number-id}/messages` no acepta ningún
 *    parámetro para pisar un mensaje anterior (la edición de 15 minutos es de
 *    la app, no de la API de negocios).
 *  - DM de Instagram y de Messenger, Mercado Libre, Gmail y Outlook: tampoco.
 *  - Comentario de Instagram: la API sólo deja ocultar y borrar; el texto no.
 *  - Comentario de TikTok: igual, sin edición.
 *
 * Quedan dos donde la edición es real y la ve el cliente:
 *  - **Chat web**: es nuestro; el widget repinta el mensaje en el sondeo.
 *  - **Comentario de Facebook**: Graph acepta `POST /{comment-id}` con
 *    `message`, y el comentario cambia en el post público.
 *
 * Ofrecer "editar" en los demás sería un botón que cambia la bandeja y deja
 * al cliente leyendo el texto viejo: peor que no tenerlo.
 */
export function canalPermiteEditar(channel: Channel): boolean {
  return channel === "webchat" || channel === "fb_comment";
}

/** Sólo lo que escribió el comercio, que llegó, y que es texto. */
export function puedeEditarse(message: Message): boolean {
  if (!canalPermiteEditar(message.channel)) return false;
  if (message.sender_type !== "agent" && message.sender_type !== "bot") return false;
  if (message.status === "failed") return false;
  return (message.content_text ?? "").trim().length > 0;
}

/** Tope del texto reescrito: el mismo que acepta el composer. */
export const MAX_EDIT_LENGTH = 4096;
