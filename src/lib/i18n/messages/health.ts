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

  // Decisiones que esperan a una persona
  approvalsTitle: { es: "Esperando tu decisión", en: "Waiting on you" },
  approvalApprove: { es: "Aprobar", en: "Approve" },
  approvalReject: { es: "Rechazar", en: "Reject" },
  approvalFailed: {
    es: "No se pudo registrar la decisión.",
    en: "Couldn't record the decision.",
  },

  // Ingresos atribuidos
  revenueTitle: {
    es: "Qué hubo antes de esas compras",
    en: "What came before those purchases",
  },
  revenueAttributedTotal: {
    es: "{total} en {orders} pedidos",
    en: "{total} across {orders} orders",
  },
  // Pedidos TOCADOS: probados e influidos juntos. Es el universo que cuentan
  // las filas de abajo, no la cifra de ventas probadas de la tarjeta.
  revenueTouchedTotal: {
    es: "{total} en {orders} pedidos tocados",
    en: "{total} across {orders} touched orders",
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
  kindAgent: { es: "Asistente", en: "Assistant" },
  kindIgAgent: { es: "Agente IG", en: "IG agent" },
  revenueNothingAttributed: {
    es: "Todavía no hay pedidos que se puedan atribuir a un envío de Riverz en este rango.",
    en: "No orders in this range can be traced back to a Riverz message yet.",
  },
  // Lo que resolvió sola: la mitad que no es plata.
  soloTitle: { es: "Lo que resolvió sola", en: "What it handled alone" },
  soloShare: {
    es: "{share}% de {total} conversaciones",
    en: "{share}% of {total} conversations",
  },
  soloResolved: {
    es: "cerradas sin que interviniera una persona",
    en: "closed without a person stepping in",
  },
  soloAfterHours: {
    es: "fuera de horario — no había nadie para contestarlas",
    en: "outside business hours — nobody was there to answer",
  },
  soloNoSchedule: {
    es: "Carga el horario del agente para saber cuántas fueron fuera de hora.",
    en: "Set the agent's business hours to see how many came in after hours.",
  },
  soloFirstReply: { es: "Primera respuesta:", en: "First reply:" },
  soloHuman: { es: "una persona:", en: "a person:" },
  soloEscalated: {
    es: "Devolvió {n} a una persona:",
    en: "Handed {n} back to a person:",
  },
  durSeconds: { es: "{n} s", en: "{n}s" },
  durMinutes: { es: "{n} min", en: "{n} min" },
  durHours: { es: "{h} h", en: "{h}h" },
  durHoursMinutes: { es: "{h} h {m} min", en: "{h}h {m}m" },

  // Por qué devolvió el hilo. Cada motivo tiene un arreglo distinto, así que
  // se nombran por lo que pasó y no por su código.
  reason_escalation_keyword: { es: "por pedido del cliente", en: "customer asked" },
  reason_escalate_after_messages: { es: "por cupo de respuestas", en: "reply cap reached" },
  reason_flow_handoff: { es: "por un flujo", en: "flow handoff" },
  reason_reply_burst: { es: "por ráfaga de mensajes", en: "message burst" },
  reason_approval: { es: "esperando aprobación", en: "awaiting approval" },
  reason_sin_motivo: { es: "sin motivo registrado", en: "no reason recorded" },

  revenueDisclaimer: {
    es: "Con qué habló cada comprador en las 72 h previas. Un pedido puede aparecer en varias filas; el total lo cuenta una vez.",
    en: "What each buyer engaged with in the previous 72h. One order can appear in several rows; the total counts it once.",
  },
};
