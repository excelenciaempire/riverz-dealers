import type { Namespace } from "./types";

/**
 * Avisos de "esto necesita tu atención".
 *
 * Cada línea dice QUÉ pasó y QUÉ significa, en ese orden, sin jerga: quien lo
 * lee está mirando su negocio, no un panel de sistemas. El detalle concreto (el
 * nombre de la automatización, el motivo del rechazo) lo agrega la interfaz al
 * lado, así que el texto no lo repite.
 */
export const health: Namespace = {
  needsAttention: { es: "Necesita tu atención", en: "Needs your attention" },

  automation_stuck: {
    es: "{n} envío(s) de una automatización quedaron a medias y no van a salir solos",
    en: "{n} automation run(s) stalled halfway and won't finish on their own",
  },
  sends_failing: {
    es: "{n} mensajes no se pudieron entregar en las últimas horas",
    en: "{n} messages couldn't be delivered in the last few hours",
  },
  whatsapp_blocked: {
    es: "WhatsApp está bloqueado para enviar: revisa el medio de pago y los datos fiscales en Meta",
    en: "WhatsApp is blocked from sending: check your payment method and tax details in Meta",
  },
  connection_error: {
    es: "{n} conexión(es) dejaron de funcionar y hay que volver a conectarlas",
    en: "{n} connection(s) stopped working and need reconnecting",
  },
  template_rejected: {
    es: "{n} plantilla(s) rechazadas por Meta: no se pueden usar hasta corregirlas",
    en: "{n} template(s) rejected by Meta: unusable until you fix them",
  },
  broadcast_stalled: {
    es: "{n} campaña(s) quedaron enviando y no terminaron",
    en: "{n} campaign(s) got stuck sending and never finished",
  },

  // Ingresos atribuidos
  revenueTitle: { es: "Lo que generó Riverz", en: "What Riverz generated" },
  revenueStoreTotal: {
    es: "Tienda: {total} en {orders} pedidos",
    en: "Store: {total} across {orders} orders",
  },
  revenueByAutomation: { es: "Por automatización", en: "By automation" },
  revenueByBroadcast: { es: "Por campaña", en: "By campaign" },
  revenueByFlow: { es: "Por flujo", en: "By flow" },
  revenueByIgAgent: { es: "Agente de Instagram", en: "Instagram agent" },
  revenueNothingAttributed: {
    es: "Todavía no hay pedidos que se puedan atribuir a un envío de Riverz en este rango.",
    en: "No orders in this range can be traced back to a Riverz message yet.",
  },
  revenueDisclaimer: {
    es: "Cuenta el pedido de quien recibió un mensaje en las 72 h previas. Las vistas no se suman entre sí: un mismo pedido puede aparecer en varias.",
    en: "Counts orders from people who got a message in the previous 72h. The views don't add up: one order can appear in several.",
  },
};
