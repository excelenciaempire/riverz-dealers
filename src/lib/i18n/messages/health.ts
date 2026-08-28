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
  // Aparte de `sends_failing` porque el cliente se quedó esperando algo que le
  // prometieron hablando: no es un envío más que no salió.
  voice_send_failed: {
    es: "{n} WhatsApp que el agente prometió en una llamada no llegaron al cliente",
    en: "{n} WhatsApp messages the agent promised on a call never reached the customer",
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

  // El detalle del aviso. El crudo que devuelve la base viene en inglés y con
  // el código pelado de Meta; estas claves lo dicen en el idioma del comercio.
  // Lo que no reconocemos se muestra tal cual: perder el detalle es peor.
  detailNoReason: {
    es: "el canal no informó el motivo",
    en: "the channel gave no reason",
  },
  // Lo único que el comercio puede hacer, y no depende del código de Meta.
  detailVoiceSendFailed: {
    es: "escríbele desde la bandeja para que no se quede esperando",
    en: "message them from the inbox so they aren't left waiting",
  },
  detailTemplateNamed: {
    es: "la plantilla «{name}» ya no existe",
    en: "template “{name}” no longer exists",
  },
  detailTemplateMissing: {
    es: "la plantilla que usaba ya no existe",
    en: "the template it used no longer exists",
  },
  detailNoRecipients: {
    es: "no había a quién enviarlo",
    en: "there was nobody to send it to",
  },
  detailInvalidPhone: {
    es: "el número de teléfono no es válido",
    en: "the phone number isn't valid",
  },
  detailUnsubscribed: {
    es: "el contacto se dio de baja",
    en: "the contact unsubscribed",
  },
  detailNoConnection: {
    es: "el canal no está conectado",
    en: "the channel isn't connected",
  },
  detailRateLimited: {
    es: "se alcanzó el límite de envíos del canal",
    en: "the channel's sending limit was reached",
  },
  detailTimeout: {
    es: "el canal tardó demasiado en responder",
    en: "the channel took too long to respond",
  },
  detailAuth: {
    es: "la conexión perdió el permiso: hay que volver a conectarla",
    en: "the connection lost access: reconnect it",
  },

  // El correo diario del cron `issues-alert`. Va aparte de las líneas de
  // arriba porque no lo lee nadie mirando la pantalla: no hay interfaz al lado
  // que agregue el link ni el detalle, así que cada frase se basta sola y
  // termina en lo que hay que hacer. El idioma sale de `profiles.locale` del
  // dueño; sin cookie de por medio, un cron no tiene request.
  mailSubject: {
    es: "Riverz · algo dejó de funcionar en {workspace}",
    en: "Riverz · something stopped working in {workspace}",
  },
  mailReview: { es: "revisar", en: "review" },
  /** Cuando el workspace todavía no tiene nombre puesto. */
  mailYourAccount: { es: "tu cuenta", en: "your account" },
  mailFooter: {
    es: "Esto se revisa una vez por día. Si ya lo resolviste, mañana no vuelve.",
    en: "We check this once a day. If you've already fixed it, it won't come back tomorrow.",
  },
  // Con el nombre del canal adentro: es el dato que dice cuál reconectar.
  mailConnectionNamed: {
    es: "Se desconectó {channels}. Vuelve a conectarlo para que los mensajes sigan saliendo",
    en: "{channels} disconnected. Reconnect it so messages keep going out",
  },
  mailConnectionPlain: {
    es: "{n} conexión(es) dejaron de funcionar. Vuelve a conectarlas",
    en: "{n} connection(s) stopped working. Reconnect them",
  },
  mailWhatsappBlocked: {
    es: "Tu WhatsApp no puede enviar mensajes. Meta lo bloqueó: revisa el medio de pago y los datos fiscales de la cuenta",
    en: "Your WhatsApp can't send messages. Meta blocked it: check the account's payment method and tax details",
  },

  // Ocultar el aviso ya leído. Vuelve solo si aparece algo distinto.
  dismiss: { es: "Ocultar", en: "Dismiss" },

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

  // Por qué NO contestó. `ai_replies.skip_reason` guarda un código interno y el
  // panel lo mostraba crudo —«debounced_by_newer_inbound» en la cara del
  // comercio—, que es la forma más rápida de que una pantalla parezca rota.
  // Un código sin traducción cae en `skipOther`: mejor "otro motivo" que un
  // identificador de la base.
  skip_ai_disabled_for_conversation: {
    es: "el asistente está apagado en ese chat",
    en: "the assistant is off in that chat",
  },
  skip_conversation_assigned: {
    es: "ya la atendía una persona",
    en: "a person was already on it",
  },
  skip_conversation_closed: {
    es: "la conversación ya estaba cerrada",
    en: "the conversation was already closed",
  },
  skip_outside_hours: { es: "fuera de horario", en: "outside business hours" },
  skip_debounced_by_newer_inbound: {
    es: "llegó otro mensaje antes",
    en: "another message arrived first",
  },
  skip_stale_by_newer_inbound: {
    es: "llegó otro mensaje antes",
    en: "another message arrived first",
  },
  skip_escalation_keyword: { es: "por pedido del cliente", en: "customer asked" },
  skip_escalate_after_messages: {
    es: "por cupo de respuestas",
    en: "reply cap reached",
  },
  skip_reply_burst_guard: { es: "por ráfaga de mensajes", en: "message burst" },
  skip_opted_out: {
    es: "el cliente pidió no recibir mensajes",
    en: "the customer opted out",
  },
  skip_recently_contacted: {
    es: "ya se le había escrito hace poco",
    en: "already messaged recently",
  },
  skip_already_paid: { es: "el pedido ya estaba pago", en: "the order was already paid" },
  skip_empty_reply: { es: "no tenía nada que decir", en: "nothing to say" },
  skip_risk: { es: "el mensaje necesitaba revisión", en: "the reply needed review" },
  skip_no_phone: { es: "el contacto no tiene teléfono", en: "the contact has no phone" },
  skip_tool_loop_truncated_fallback: {
    es: "se quedó sin pasos",
    en: "ran out of steps",
  },
  skipOther: { es: "otro motivo", en: "another reason" },

  revenueDisclaimer: {
    es: "Con qué habló cada comprador en las 72 h previas. Un pedido puede aparecer en varias filas; el total lo cuenta una vez.",
    en: "What each buyer engaged with in the previous 72h. One order can appear in several rows; the total counts it once.",
  },
};
