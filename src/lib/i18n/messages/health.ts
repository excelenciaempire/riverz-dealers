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
  automation_failed: {
    es: "{n} corrida(s) de una automatización fallaron",
    en: "{n} automation run(s) failed",
  },
  broadcast_stalled: {
    es: "{n} campaña(s) quedaron enviando y no terminaron",
    en: "{n} campaign(s) got stuck sending and never finished",
  },
  nadie_atiende: {
    es: "Entran mensajes por {n} canal(es) y no hay ningún asistente atendiendo",
    en: "Messages are coming in through {n} channel(s) and no assistant is answering",
  },

  // Decisiones que esperan a una persona
  approvalsTitle: { es: "Esperando tu decisión", en: "Waiting on you" },
  approvalApprove: { es: "Aprobar", en: "Approve" },
  approvalReject: { es: "Rechazar", en: "Reject" },
  approvalFailed: {
    es: "No se pudo registrar la decisión.",
    en: "Couldn't record the decision.",
  },

  // Ingresos atribuidos
  revenueTitle: { es: "De dónde salió esa plata", en: "Where that money came from" },
  revenueAttributedTotal: {
    es: "{total} en {orders} pedidos",
    en: "{total} across {orders} orders",
  },
  revenueStoreTotal: {
    es: "Tienda: {total} en {orders} pedidos",
    en: "Store: {total} across {orders} orders",
  },
  // Qué clase de cosa hizo esa plata. Va al lado del nombre y no como
  // encabezado de una lista propia: casi siempre hay una sola clase, y cuatro
  // encabezados para una fila cada uno son ruido, no estructura.
  kindAutomation: { es: "Automatización", en: "Automation" },
  kindBroadcast: { es: "Campaña", en: "Campaign" },
  kindFlow: { es: "Flujo", en: "Flow" },
  kindIgAgent: { es: "Agente IG", en: "IG agent" },
  revenueNothingAttributed: {
    es: "Todavía no hay pedidos que se puedan atribuir a un envío de Riverz en este rango.",
    en: "No orders in this range can be traced back to a Riverz message yet.",
  },
  revenueDisclaimer: {
    es: "Cuenta el pedido de quien recibió un mensaje en las 72 h previas. Un mismo pedido puede aparecer en más de una fila; el total lo cuenta una sola vez.",
    en: "Counts orders from people who got a message in the previous 72h. One order can appear in more than one row; the total counts it once.",
  },
};
