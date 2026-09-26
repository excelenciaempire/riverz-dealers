import type { Namespace } from "./types";

/** Automations: list/gallery, builder canvas, trigger/step config, detail + run logs. */
export const automations = {
  'tpl_postventa-reposicion_name': { es: 'Recompras', en: 'Reorders' },
  'tpl_postventa-reposicion_desc': {
    es: 'Empieza con el pago acreditado o la confirmación del cliente en contra entrega. Envía los mensajes en los días configurados; la IA gestiona las respuestas.',
    en: 'Starts when payment clears or the customer confirms a cash-on-delivery order. Sends messages on the configured days; AI handles replies.',
  },
  confirmedOrderSummary: { es: 'Pago acreditado o contra entrega confirmado', en: 'Payment cleared or cash on delivery confirmed' },
  confirmedOrderPayment: { es: 'Pago anticipado: empieza cuando se acredita el pago.', en: 'Prepayment: starts when payment clears.' },
  confirmedOrderCod: { es: 'Contra entrega: espera la confirmación del cliente registrada en el pedido.', en: 'Cash on delivery: waits for the customer’s confirmation to be recorded on the order.' },
  confirmedOrderTiming: { es: 'Los días se cuentan desde esa confirmación. Cada espera se suma a la anterior.', en: 'Days count from that confirmation. Each wait adds to the previous one.' },
  retentionAiReplies: { es: 'Si el cliente responde, se pausan los mensajes pendientes y continúa la IA.', en: 'When the customer replies, pending messages pause and AI takes over.' },
  retentionEvents: { es: 'Entrega, respuestas y devoluciones', en: 'Delivery, replies and returns' },
  retentionReplenishment: { es: 'Incluir recompra', en: 'Include reordering' },
  dpJourneyEvent: { es: 'Evento del recorrido', en: 'Journey event' },
  journeyEvent_main: { es: 'Pedido entregado', en: 'Order delivered' },
  journeyEvent_help: { es: 'Solicita ayuda', en: 'Requests help' },
  journeyEvent_later: { es: 'Prefiere más adelante', en: 'Prefers a later reminder' },
  journeyEvent_stop: { es: 'No quiere recordatorios', en: 'Stops reminders' },
  journeyEvent_repeat: { es: 'Quiere repetir la compra', en: 'Wants to reorder' },
  journeyEvent_later_15: { es: 'Recordar en 15 días', en: 'Remind in 15 days' },
  journeyEvent_later_30: { es: 'Recordar en 30 días', en: 'Remind in 30 days' },
  journeyEvent_shopify_order_cancelled: { es: 'Pedido cancelado', en: 'Order cancelled' },
  journeyEvent_shopify_order_refunded: { es: 'Pedido reembolsado', en: 'Order refunded' },
  issueEventEntries: { es: 'Revisa los eventos del recorrido.', en: 'Review the journey events.' },
  'tpl_postventa-acompanamiento_name': { es: 'Acompañamiento postventa', en: 'Post-purchase care' },
  'tpl_postventa-acompanamiento_desc': {
    es: 'Atención tras la entrega para productos sin reposición. Incluye plantillas y gestión de ayuda. No genera ofertas de recompra ni cobros de suscripción.',
    en: 'Delivery follow-up for products without replenishment. Includes templates and support handling. Does not generate reorder offers or subscription charges.',
  },
  // Connection gate (layout)
  connectGateTitle: {
    es: "Conecta un canal antes de automatizar",
    en: "Connect a channel before automating",
  },
  connectGateDescription: {
    es: "Conecta WhatsApp, Instagram, Messenger o un email para empezar.",
    en: "Connect WhatsApp, Instagram, Messenger or an email to get started.",
  },

  // List page — header + actions
  pageTitle: { es: "Automatizaciones", en: "Automations" },
  createFromScratch: { es: "Crear desde cero", en: "Create from scratch" },
  // Tablero de mensajes: todo lo que se le envía al cliente, por situación.
  tablero: { es: "Tablero de mensajes", en: "Message board" },
  tableroHint: {
    es: "Lo que recibe el cliente en cada situación, con un pedido de ejemplo. Edita los textos aquí mismo.",
    en: "What the customer gets in each situation, with a sample order. Edit the copy right here.",
  },
  tableroEjemplo: { es: "Con datos de ejemplo", en: "With sample data" },
  tableroVariables: { es: "Con variables", en: "With variables" },
  tableroPagado: { es: "Compra pagada", en: "Paid purchase" },
  tableroContraentrega: { es: "Compra contra entrega", en: "Cash on delivery" },
  tableroTransferencia: { es: "Pago por transferencia", en: "Bank transfer payment" },
  tableroPendiente: { es: "Pago pendiente", en: "Payment pending" },
  tableroCarrito: { es: "Carrito abandonado", en: "Abandoned cart" },
  tableroRechazado: { es: "Pago rechazado", en: "Payment declined" },
  tableroDespachado: { es: "Despachado", en: "Shipped" },
  tableroEntregado: { es: "Entregado", en: "Delivered" },
  tableroCancelado: { es: "Cancelado", en: "Cancelled" },
  tableroVacio: { es: "Nada se envía en esta situación.", en: "Nothing is sent in this situation." },
  tableroEspera: { es: "Espera {n} {unit}", en: "Waits {n} {unit}" },
  tableroSeDetiene: { es: "se detiene si responde", en: "stops if they reply" },
  tableroPasaA: { es: "Después contesta {agente}", en: "Then {agente} replies" },
  tableroLlamada: { es: "Llamada de {agente}", en: "Call from {agente}" },
  tableroSi: { es: "Si {desc}", en: "If {desc}" },
  tableroOmitida: { es: "No se envía: {motivo}", en: "Not sent: {motivo}" },
  tableroBorrador: { es: "Borrador", en: "Draft" },
  tableroArmada: { es: "Esperando a Meta", en: "Waiting on Meta" },
  tableroActiva: { es: "Activa", en: "Active" },
  tableroEditar: { es: "Editar texto", en: "Edit copy" },
  tableroGuardar: { es: "Guardar", en: "Save" },
  tableroCancelar: { es: "Cancelar", en: "Cancel" },
  tableroGuardado: { es: "Texto guardado", en: "Copy saved" },
  tableroNoEditable: {
    es: "Esta plantilla ya está en Meta: se cambia creando una nueva desde Plantillas.",
    en: "This template is already in Meta: change it by creating a new one in Templates.",
  },
  tableroVariablesCambiadas: {
    es: "Mantén las mismas variables: cada una está atada a un dato del pedido.",
    en: "Keep the same variables: each one is tied to an order field.",
  },
  tableroMuyLargo: { es: "Meta acepta hasta 1024 caracteres.", en: "Meta accepts up to 1024 characters." },
  tableroBordeVariable: {
    es: "Meta no acepta un texto que empiece o termine con una variable.",
    en: "Meta doesn't accept copy that starts or ends with a variable.",
  },
  tableroCargando: { es: "Armando el tablero…", en: "Building the board…" },
  tableroError: { es: "No se pudo armar el tablero.", en: "Couldn't build the board." },
  tableroEnviar: { es: "Enviar {n} a Meta", en: "Send {n} to Meta" },
  tableroEnviarConfirm: {
    es: "¿Enviar {n} plantillas a aprobación de Meta? Una vez enviadas, su nombre queda tomado y el texto ya no se edita desde aquí.",
    en: "Send {n} templates for Meta approval? Once sent, their names are taken and the copy can no longer be edited here.",
  },
  tableroEnviadas: { es: "{n} plantillas en revisión de Meta", en: "{n} templates under Meta review" },
  tableroErrorGuardar: { es: "No se pudo guardar el texto.", en: "Couldn't save the copy." },
  retry: { es: "Reintentar", en: "Retry" },

  // List page — channel notice
  runsThroughWhatsapp: {
    es: "Tus automatizaciones se ejecutan por tu WhatsApp conectado",
    en: "Your automations run through your connected WhatsApp",
  },
  noWhatsappTitle: { es: "No hay un WhatsApp conectado", en: "No WhatsApp connected" },
  automationsSendViaWhatsapp: {
    es: "Las automatizaciones envían por WhatsApp.",
    en: "Automations send through WhatsApp.",
  },
  connectWhatsapp: { es: "Conectar WhatsApp", en: "Connect WhatsApp" },

  // List page — sections
  readyTemplates: { es: "Plantillas listas", en: "Ready-made templates" },
  availableCount: { es: "{n} disponibles", en: "{n} available" },
  myAutomations: { es: "Mis automatizaciones", en: "My automations" },
  installedCountOne: { es: "{n} instalada", en: "{n} installed" },
  installedCountOther: { es: "{n} instaladas", en: "{n} installed" },
  emptyInstalled: { es: "Aún no tienes ninguna", en: "You don't have any yet" },
  viewTemplate: { es: "Ver plantilla", en: "View template" },
  viewStats: { es: "Ver estadísticas", en: "View stats" },

  // Automation-template gallery: display name + pitch per template
  // (keyed by slug as `tpl_<slug>_name` / `tpl_<slug>_desc`). Only the
  // gallery metadata is translated — the suggested_template_body / step
  // copy stay in the catalog (customer-facing copy the merchant edits).
  "tpl_carrito-abandonado_name": { es: "Carrito abandonado", en: "Abandoned cart" },
  "tpl_carrito-abandonado_desc": {
    es: "A la hora de abandonar el carrito, si todavía no compró, le damos una forma directa de retomarlo o pedir ayuda. Marca como recuperado solo a quien compra después.",
    en: "One hour after the cart is abandoned, if they still haven't purchased, we give them a direct way to finish or ask for help. Only those who buy afterwards get tagged as recovered.",
  },
  "tpl_pago-rechazado_name": { es: "Pago rechazado", en: "Declined payment" },
  "tpl_pago-rechazado_desc": {
    es: "Al cliente se le rechazó el pago y a los 10 minutos todavía no completó la compra. Le escribimos para retomarla.",
    en: "The customer's payment was declined and 10 minutes later they still haven't completed the purchase. We reach out to pick it back up.",
  },
  "tpl_pago-pendiente_name": { es: "Pago pendiente", en: "Pending payment" },
  "tpl_pago-pendiente_desc": {
    es: "El cliente hizo el pedido pero todavía no pagó (transferencia). Le recordamos a la hora, a las 6 y a las 24, y paramos apenas paga.",
    en: "The customer placed the order but hasn't paid yet (bank transfer). We remind them at 1 h, 6 h and 24 h, and stop the moment they pay.",
  },
  "tpl_nuevo-pedido_name": { es: "Nuevo pedido", en: "New order" },
  "tpl_nuevo-pedido_desc": {
    es: "Confirmamos al cliente apenas hace un pedido en tu tienda. Le mandamos un resumen con el número de orden, el total y un agradecimiento.",
    en: "We confirm with the customer the moment they place an order in your store. We send a summary with the order number, the total and a thank-you.",
  },
  "tpl_enviar-tracking_name": { es: "Enviar tracking", en: "Send tracking" },
  "tpl_enviar-tracking_desc": {
    es: "Cuando despachamos un pedido, le mandamos al cliente el número de seguimiento y el link del courier.",
    en: "When an order ships, we send the customer the tracking number and the courier link.",
  },
  "tpl_post-survey_name": { es: "Encuesta post-compra", en: "Post-purchase survey" },
  "tpl_post-survey_desc": {
    es: "Tres días después de que llega el pedido, le preguntamos al cliente cómo le fue. La respuesta queda registrada en la conversación para revisar.",
    en: "Three days after the order arrives, we ask the customer how it went. Their reply is saved in the conversation for you to review.",
  },
  "tpl_recompras_name": { es: "Recompras", en: "Repeat purchases" },
  "tpl_recompras_desc": {
    es: "A los 45 días del último pedido reactivamos al cliente con un mensaje distinto según cuánto compró: por volumen (3+ unidades) le proponemos reponer con oferta de volumen; individual, volver a pedir su producto. El camino se puede cambiar por la oferta o el producto elegido. Dispara una vez por ciclo.",
    en: "45 days after the last order we re-engage with a different message based on how much they bought: bulk buyers (3+ units) get a volume-restock offer; single buyers, a reorder nudge. The path can be switched to the chosen offer or product. Fires once per cycle.",
  },

  // List page — card actions / menu
  openMenu: { es: "Abrir menú", en: "Open menu" },
  edit: { es: "Editar", en: "Edit" },
  duplicate: { es: "Duplicar", en: "Duplicate" },
  delete: { es: "Eliminar", en: "Delete" },
  cancel: { es: "Cancelar", en: "Cancel" },
  activate: { es: "Activar", en: "Activate" },
  deactivate: { es: "Desactivar", en: "Deactivate" },

  // List page — run summary
  executionCountOne: { es: "{n} ejecución", en: "{n} run" },
  executionCountOther: { es: "{n} ejecuciones", en: "{n} runs" },
  lastRun: { es: "última {time}", en: "last {time}" },

  // List page — delete dialog
  deleteDialogTitlePrefix: { es: "¿Eliminar", en: "Delete" },
  deleteDialogDescription: {
    es: "Se eliminará también su historial de ejecuciones.",
    en: "Its run history will be deleted too.",
  },

  // List page — toasts / errors
  loadFailed: {
    es: "No se pudieron cargar las automatizaciones",
    en: "Couldn't load automations",
  },
  updateFailed: { es: "No se pudo actualizar", en: "Couldn't update" },
  duplicateFailed: { es: "No se pudo duplicar", en: "Couldn't duplicate" },
  deleteFailed: { es: "No se pudo eliminar", en: "Couldn't delete" },
  toastActivated: { es: "Activada", en: "Activated" },
  toastPaused: { es: "Pausada", en: "Paused" },
  toastDuplicated: { es: "Duplicada", en: "Duplicated" },
  toastDeleted: { es: "Eliminada", en: "Deleted" },

  // Builder — header + save
  back: { es: "Atrás", en: "Back" },
  active: { es: "Activa", en: "Active" },
  paused: { es: "Pausada", en: "Paused" },
  armed: { es: "Armada", en: "Armed" },
  armedWaitingMeta: { es: "Armada, esperando Meta", en: "Armed, waiting for Meta" },
  blockedByMeta: { es: "Bloqueada por Meta", en: "Blocked by Meta" },
  pendingTemplate: { es: "Pendiente de plantilla", en: "Template pending" },
  pendingMercadoPago: { es: "Pendiente de Mercado Pago", en: "Mercado Pago pending" },
  untitledAutomation: { es: "Automatización sin título", en: "Untitled automation" },
  undo: { es: "Deshacer", en: "Undo" },
  redo: { es: "Rehacer", en: "Redo" },
  save: { es: "Guardar", en: "Save" },
  saveDraft: { es: "Guardar borrador", en: "Save draft" },
  useTemplate: { es: "Usar plantilla", en: "Use template" },
  saveFailed: { es: "No se pudo guardar", en: "Couldn't save" },
  unsavedTitle: { es: "Hay cambios sin guardar", en: "You have unsaved changes" },
  unsavedBody: {
    es: "Si sales ahora se pierden.",
    en: "If you leave now, they're lost.",
  },
  unsavedDiscard: { es: "Salir sin guardar", en: "Leave without saving" },
  unsavedSave: { es: "Guardar y salir", en: "Save and leave" },
  toastSaved: { es: "Guardada", en: "Saved" },
  toastCreated: { es: "Creada", en: "Created" },
  toastTemplateAdded: { es: "Plantilla agregada", en: "Template added" },
  templatePreviewBanner: {
    es: "Vista previa de la plantilla.",
    en: "Template preview.",
  },
  noWhatsappCantSend: {
    es: "No hay un WhatsApp conectado, no podrá enviar mensajes.",
    en: "No WhatsApp connected: it won't be able to send messages.",
  },

  // Builder — live preview rail
  preview: { es: "Vista previa", en: "Preview" },
  closePreview: { es: "Cerrar vista previa", en: "Close preview" },
  templateLabel: { es: "Plantilla: {name}", en: "Template: {name}" },
  selectTemplatePlaceholder: {
    es: "Selecciona una plantilla…",
    en: "Select a template…",
  },

  // Builder — trigger card
  triggerEyebrow: { es: "Activador", en: "Trigger" },
  triggerEyebrowShopify: { es: "Activador · Tienda", en: "Trigger · Store" },
  triggerPlatformLabel: {
    es: "¿De qué tienda? Si no eliges ninguna, vale para todas.",
    en: "Which store? If you pick none, it applies to all.",
  },
  // El activador está en la lista pero la tienda elegida no emite ese evento:
  // sin este aviso la automatización queda muda y nada lo explica.
  triggerUnsupportedOnPlatform: {
    es: "{platform} no emite este evento: la automatización nunca se va a disparar. Solo funciona con Shopify.",
    en: "{platform} never emits this event, so this automation will never fire. It only works with Shopify.",
  },
  triggerTagAdded: { es: "Etiqueta añadida", en: "Tag added" },
  triggerShopifyOrderCreated: { es: "Nuevo pedido", en: "New order" },
  triggerShopifyOrderConfirmed: { es: 'Pedido confirmado', en: 'Order confirmed' },
  triggerShopifyOrderPaid: {
    es: "Pedido pagado",
    en: "Order paid",
  },
  triggerShopifyOrderFulfilled: {
    es: "Pedido despachado",
    en: "Order fulfilled",
  },
  triggerShopifyOrderDelivered: {
    es: "Pedido entregado",
    en: "Order delivered",
  },
  triggerShopifyOrderCancelled: {
    es: "Pedido cancelado",
    en: "Order cancelled",
  },
  triggerShopifyOrderRefunded: {
    es: "Pedido reembolsado",
    en: "Order refunded",
  },
  triggerShopifyAbandonedCheckout: {
    es: "Carrito abandonado",
    en: "Abandoned checkout",
  },
  triggerPaymentRejected: {
    es: "Pago rechazado (Mercado Pago)",
    en: "Payment declined (Mercado Pago)",
  },
  triggerVoiceCallCompleted: {
    es: "Llamada finalizada (Voz IA)",
    en: "Call finished (Voice AI)",
  },
  // Legacy / cron-driven triggers — not offered when building a NEW automation
  // but shown with their real name when editing an existing one.
  triggerPostDeliveryFeedback: {
    es: "Reseña post-entrega",
    en: "Post-delivery review",
  },
  triggerCustomerInactive: { es: "Cliente inactivo", en: "Inactive customer" },
  triggerKeywordMatch: { es: "Palabra clave", en: "Keyword match" },
  triggerTimeBased: { es: "Programado", en: "Scheduled" },
  triggerNewMessage: { es: "Mensaje recibido", en: "Message received" },
  triggerFirstInbound: { es: "Primer mensaje", en: "First message" },
  triggerNewContact: { es: "Contacto nuevo", en: "New contact" },
  triggerConversationAssigned: {
    es: "Conversación asignada",
    en: "Conversation assigned",
  },
  cronOrTimePlaceholder: { es: "Expresión cron o HH:mm", en: "Cron expression or HH:mm" },

  // Data points (plain-language names shared by conditions + template variables)
  dpUnits: { es: "Unidades que compró", en: "Units they bought" },
  dpOffer: { es: "Oferta que eligió", en: "Offer they chose" },
  dpTotal: { es: "Total del pedido", en: "Order total" },
  dpItemCount: { es: "Cantidad de productos distintos", en: "Number of distinct products" },
  dpFirstItem: { es: "Primer producto", en: "First product" },
  dpRetentionProduct: { es: "Producto para recompra", en: "Reorder product" },
  dpRetentionUnits: { es: "Unidades de ese producto", en: "Units of that product" },
  dpOrderItems: { es: 'Productos y cantidades', en: 'Products and quantities' },
  dpDeliveryAddress: { es: 'Dirección completa de entrega', en: 'Full delivery address' },
  dpShippingMethod: { es: 'Método de envío elegido', en: 'Chosen shipping method' },
  dpDeliveryPhone: { es: 'Teléfono de entrega', en: 'Delivery phone' },
  dpRecipientName: { es: 'Nombre del destinatario', en: 'Recipient name' },
  dpRepeatCustomer: { es: "Es cliente recurrente", en: "Is a repeat customer" },
  dpCustomerName: { es: "Nombre del cliente", en: "Customer name" },
  dpCustomerFirstName: { es: "Primer nombre del cliente", en: "Customer first name" },
  dpCustomerLastName: { es: "Apellido del cliente", en: "Customer last name" },
  dpCustomerEmail: { es: "Correo del cliente", en: "Customer email" },
  dpCustomerPhone: { es: "Teléfono del cliente", en: "Customer phone" },
  dpOrderName: { es: "Nombre del pedido", en: "Order name" },
  dpOrderNumber: { es: "Número de pedido", en: "Order number" },
  dpSubtotal: { es: "Subtotal", en: "Subtotal" },
  dpDiscounts: { es: "Descuentos", en: "Discounts" },
  dpFinancialStatus: { es: "Estado de pago", en: "Payment status" },
  dpPaymentMethod: { es: "Método de pago", en: "Payment method" },
  paymentMethodCashOnDelivery: { es: "Contraentrega", en: "Cash on delivery" },
  dpFulfillmentStatus: { es: "Estado de envío", en: "Fulfillment status" },
  dpShippingAddress: { es: "Dirección de envío", en: "Shipping address" },
  dpShippingCity: { es: "Ciudad de envío", en: "Shipping city" },
  dpShippingProvince: { es: "Provincia de envío", en: "Shipping state/province" },
  dpShippingZip: { es: "Código postal de envío", en: "Shipping ZIP" },
  dpShippingCountry: { es: "País de envío", en: "Shipping country" },
  dpOrderStatusUrl: { es: "Link de estado del pedido", en: "Order status link" },
  dpCurrency: { es: "Moneda", en: "Currency" },
  dpTrackingNumber: { es: "Número de seguimiento", en: "Tracking number" },
  dpTrackingUrl: { es: "Link de seguimiento", en: "Tracking link" },
  dpTrackingCompany: { es: "Transportista", en: "Carrier" },
  dpCheckoutUrl: { es: "Link del carrito", en: "Cart link" },
  mpNotConnected: {
    es: "Falta conectar Mercado Pago. Sin eso no llega ningún pago rechazado y esta automatización no se dispara.",
    en: "Mercado Pago isn't connected yet. Without it no declined payments arrive and this automation never fires.",
  },
  mpConnectCta: { es: "Conectar Mercado Pago", en: "Connect Mercado Pago" },
  condValueLabel: { es: "Valor", en: "Value" },
  purchasedNo: { es: "No compró", en: "Hasn't purchased" },
  purchasedYes: { es: "Sí compró", en: "Has purchased" },
  windowSinceTrigger: { es: "desde que empezó", en: "since it started" },
  windowEver: { es: "alguna vez", en: "ever" },
  dpMessaged: { es: "Ya le escribimos", en: "Already messaged" },
  dpRejectedOpen: {
    es: "Tiene un pago rechazado sin resolver",
    en: "Has an unresolved declined payment",
  },
  dpOrderPaid: { es: "Pagó el pedido", en: "Order is paid" },
  messagedNo: { es: "No le escribimos", en: "Not messaged" },
  messagedYes: { es: "Ya le escribimos", en: "Already messaged" },
  rejectedOpenNo: { es: "Sin pago rechazado", en: "No declined payment" },
  rejectedOpenYes: { es: "Con pago rechazado", en: "Has a declined payment" },
  orderPaidNo: { es: "Todavía no pagó", en: "Still unpaid" },
  orderPaidYes: { es: "Ya pagó", en: "Already paid" },
  condWhenLabel: { es: "Cuándo", en: "When" },
  windowLastMinutes: { es: "en los últimos minutos", en: "in the last minutes" },
  windowLastHours: { es: "en las últimas horas", en: "in the last hours" },
  windowLastDays: { es: "en los últimos días", en: "in the last days" },
  condWindowLabel: { es: "En las últimas", en: "In the last" },
  dpPurchased: { es: "Compró", en: "Purchased" },
  dpPaymentReason: { es: "Motivo del rechazo", en: "Decline reason" },
  dpPaymentAttempts: { es: "Intentos de pago", en: "Payment attempts" },
  dpInstallments: { es: "Cuotas", en: "Installments" },
  dpContactName: { es: "Su nombre", en: "Their name" },
  dpContactEmail: { es: "Su correo", en: "Their email" },
  dpContactCompany: { es: "Su empresa", en: "Their company" },
  dpLastOfferUnits: { es: "Unidades de su última compra", en: "Units in their last purchase" },
  dpLastOfferChosen: { es: "Su última oferta comprada", en: "Their last purchased offer" },
  dpLastProduct: { es: "Su último producto comprado", en: "Their last purchased product" },
  dpHasTag: { es: "Tiene la etiqueta", en: "Has the tag" },
  dpInSegment: { es: "Está en el grupo", en: "Is in the group" },
  dpMessageText: { es: "Lo que escribió", en: "What they wrote" },
  dpCallStatus: { es: "Estado de la llamada", en: "Call status" },
  dpCallOutcome: { es: "Resultado de la llamada", en: "Call outcome" },
  dpCallDuration: { es: "Duración de la llamada (seg)", en: "Call duration (sec)" },
  dpCallSummary: { es: "Resumen de la llamada", en: "Call summary" },
  dpTimeOfDay: { es: "Hora del día", en: "Time of day" },
  dpGroupOrder: { es: "Del pedido", en: "From the order" },
  dpGroupContact: { es: "Del contacto", en: "From the contact" },
  dpGroupMessage: { es: "Del mensaje", en: "From the message" },

  // Condition picker (natural language)
  condWhatData: { es: "¿Qué dato quieres revisar?", en: "Which data to check?" },
  condCompare: { es: "Que sea…", en: "That it is…" },
  condAnd: { es: "y", en: "and" },
  opEq: { es: "igual a", en: "equal to" },
  opGte: { es: "al menos", en: "at least" },
  opLte: { es: "como máximo", en: "at most" },
  opGt: { es: "más de", en: "more than" },
  opLt: { es: "menos de", en: "less than" },
  opBetween: { es: "entre", en: "between" },
  opNotEmpty: { es: "tiene valor", en: "has a value" },
  opEmpty: { es: "está vacío", en: "is empty" },

  // Builder — keyword match config
  keywordsLabel: {
    es: "Palabras clave (separadas por comas)",
    en: "Keywords (comma-separated)",
  },
  matchTypeLabel: { es: "Tipo de coincidencia", en: "Match type" },
  matchContains: { es: "Contiene", en: "Contains" },
  matchExact: { es: "Exacta", en: "Exact" },

  // Builder — step kinds (eyebrow)
  kindCondition: { es: "Condición", en: "Condition" },
  kindWait: { es: "Espera", en: "Wait" },
  kindAction: { es: "Acción", en: "Action" },

  // Builder — step meta labels
  stepSendMessage: { es: "Enviar mensaje", en: "Send message" },
  stepSendVoiceNote: { es: "Enviar nota de voz", en: "Send voice note" },
  stepSendTemplate: { es: "Enviar plantilla", en: "Send template" },
  stepAddTag: { es: "Añadir etiqueta", en: "Add tag" },
  stepRemoveTag: { es: "Quitar etiqueta", en: "Remove tag" },
  stepAssignConversation: { es: "Asignar conversación", en: "Assign conversation" },
  stepUpdateContactField: {
    es: "Actualizar campo del contacto",
    en: "Update contact field",
  },
  stepSetContext: { es: "Guardar contexto", en: "Store context" },
  stepWait: { es: "Esperar", en: "Wait" },
  stepCondition: { es: "Condición (Sí / No)", en: "Condition (Yes / No)" },
  stepSwitch: { es: "Condición", en: "Condition" },
  stepSendWebhook: { es: "Enviar webhook", en: "Send webhook" },
  stepCloseConversation: { es: "Cerrar conversación", en: "Close conversation" },
  stepVoiceCall: { es: "Llamar con IA", en: "Call with AI" },

  // Builder — voice_call step config
  voiceCallAgent: { es: "Agente que hará la llamada", en: "Agent placing the call" },
  voiceCallAgentHint: {
    es: "El agente define la voz y la identidad. El motivo se configura aquí.",
    en: "The agent defines the voice and identity. The reason is configured here.",
  },
  voiceCallPickAgent: { es: "Elige un agente…", en: "Pick an agent…" },
  // Elegir un agente sin voz dejaba de ser un callejón sin salida: la fila
  // ámbar dice qué falta y lleva a la pestaña donde se activa.
  voiceCallEnableVoice: {
    es: "Activar la voz de este agente",
    en: "Turn on this agent's voice",
  },
  voiceCallNoAgents: {
    es: "Aún no hay agentes de voz.",
    en: "There are no voice agents yet.",
  },
  voiceCallCreateAgent: {
    es: "Crear agente en Llamadas",
    en: "Create agent in Calls",
  },
  voiceCallObjective: {
    es: "Objetivo de esta llamada",
    en: "Objective for this call",
  },
  voiceCallObjectiveHint: {
    es: "Opcional. Si no lo cambias, usa el objetivo del agente.",
    en: "Optional. If unchanged, it uses the agent's objective.",
  },
  voiceCallObjectivePlaceholder: {
    es: "Ej. confirmar la dirección y el método de pago.",
    en: "E.g. confirm the address and payment method.",
  },
  voiceCallScenario: { es: "Motivo de la llamada", en: "Reason for the call" },
  voiceCallScenarioHint: {
    es: "Riverz adapta este objetivo a los datos reales del pedido y del cliente.",
    en: "Riverz adapts this objective to the actual order and customer data.",
  },
  voiceScenarioAutomatic: { es: "Automático (recomendado)", en: "Automatic (recommended)" },
  voiceScenarioAutomaticHint: {
    es: "Riverz elige según el evento: agradece pedidos pagados y confirma los de contra entrega.",
    en: "Riverz chooses from the event: it thanks paid orders and confirms cash-on-delivery orders.",
  },
  voiceScenarioThankOrder: { es: "Agradecer el pedido", en: "Thank for the order" },
  voiceScenarioConfirmCod: { es: "Confirmar contra entrega", en: "Confirm cash on delivery" },
  voiceScenarioCartRecovery: { es: "Recuperar carrito", en: "Recover cart" },
  voiceScenarioPaymentRecovery: { es: "Recuperar pago", en: "Recover payment" },
  voiceScenarioDeliveryUpdate: { es: "Informar sobre la entrega", en: "Share delivery update" },
  voiceScenarioCustomerFollowup: { es: "Dar seguimiento", en: "Follow up" },
  voiceScenarioCustom: { es: "Objetivo personalizado", en: "Custom objective" },
  voiceCallDetail: { es: "Detalle opcional", en: "Optional detail" },
  voiceCallDetailPlaceholder: {
    es: "Ej. agradecer con un cupón del 10 %.",
    en: "E.g. thank them with a 10% coupon.",
  },
  voiceCallDetailHint: {
    es: "Añade una instrucción solo para esta automatización.",
    en: "Add an instruction only for this automation.",
  },
  voiceCallCustomHint: {
    es: "Describe qué debe lograr el agente en esta llamada.",
    en: "Describe what the agent must accomplish in this call.",
  },
  // La rama que hace útil a la llamada. Armarla a mano pedía saber que
  // existía un nodo «Condición» y cuál de los datos era el resultado.
  voiceCallIfNoAnswer: { es: "¿Y si no contesta?", en: "And if nobody answers?" },
  voiceCallBuildBranch: {
    es: "Escribirle por WhatsApp",
    en: "Message them on WhatsApp",
  },
  voiceCallBranchDone: {
    es: "Si no contesta, sigue por el camino de abajo.",
    en: "If nobody answers, it continues on the path below.",
  },
  voiceCallAnswered: { es: "Contestó", en: "Answered" },
  voiceCallPreview: { es: "Llamada con IA", en: "AI call" },
  voiceCallPreviewPickAgent: {
    es: "Elige quién llama",
    en: "Pick who calls",
  },

  // Builder — unified multi-path "Condición" node (N filtered paths + "en otro caso")
  switchPathN: { es: "Camino {n}", en: "Path {n}" },
  switchAddCase: { es: "Añadir camino", en: "Add path" },
  switchRemoveCase: { es: "Quitar camino", en: "Remove path" },
  switchElse: { es: "En otro caso", en: "Otherwise" },
  switchNeedsData: { es: "Añade un camino", en: "Add a path" },
  switchCaseOther: { es: "{n} caminos", en: "{n} paths" },

  // Builder — step card controls
  moveBefore: { es: "Mover antes", en: "Move before" },
  moveAfter: { es: "Mover después", en: "Move after" },

  // Builder — branch lanes
  branchYes: { es: "Sí", en: "Yes" },
  branchNo: { es: "No", en: "No" },

  // Builder — add-step menu
  add: { es: "Añadir", en: "Add" },
  addStep: { es: "Añadir paso", en: "Add step" },
  dragHandle: { es: "Arrastrar para mover", en: "Drag to move" },
  dropHere: { es: "Soltar aquí", en: "Drop here" },
  dragOverSlot: {
    es: "llévalo a un hueco",
    en: "move it over a slot",
  },
  // Adónde cae la tarjeta, dicho antes de soltarla. Los huecos de dos caminos
  // distintos quedan a centímetros y se ven iguales: sin esto se suelta a
  // ciegas y el paso aparece en la rama de al lado.
  dropAtStart: { es: "Al principio", en: "At the start" },
  dropAfter: { es: "Después de {paso}", en: "After {paso}" },
  dropInLane: { es: "en el camino {camino}", en: "in the {camino} path" },
  chooseWhatToDo: { es: "Elige qué hacer", en: "Choose what to do" },

  // Builder — send_message / send_template editors
  messageText: { es: "Texto del mensaje", en: "Message text" },
  messageTextPlaceholder: {
    es: "¡Hola! Gracias por escribirnos…",
    en: "Hi! Thanks for reaching out…",
  },
  whatsappTemplate: { es: "Plantilla de WhatsApp", en: "WhatsApp template" },
  chooseTemplate: { es: "Elige una plantilla…", en: "Choose a template…" },
  noApprovedTemplates: {
    es: "No hay plantillas aprobadas todavía.",
    en: "No approved templates yet.",
  },
  createOne: { es: "Crear una", en: "Create one" },

  // Builder — tag / agent selects
  tag: { es: "Etiqueta", en: "Tag" },
  noTagsYet: { es: "Aún no tienes etiquetas.", en: "You don't have any tags yet." },
  chooseTag: { es: "Elige una etiqueta…", en: "Choose a tag…" },
  tagWriteOrPick: {
    es: "Escribe una etiqueta nueva o elige una…",
    en: "Type a new tag or pick one…",
  },
  noTeammatesYet: {
    es: "Aún no hay nadie más en tu equipo.",
    en: "There's no one else on your team yet.",
  },
  inviteSomeone: { es: "Invitar a alguien", en: "Invite someone" },
  chooseSomeone: { es: "Elige a alguien…", en: "Choose someone…" },

  // Builder — assign_conversation editor
  whoToAssign: { es: "¿A quién se la paso?", en: "Who should handle it?" },
  assignRoundRobin: { es: "Repartir entre el equipo", en: "Distribute across the team" },
  assignSpecific: { es: "Siempre a la misma persona", en: "Always the same person" },
  person: { es: "Persona", en: "Person" },

  // Builder — update_contact_field editor
  whichField: { es: "¿Qué campo actualizar?", en: "Which field to update?" },
  fieldName: { es: "Nombre", en: "Name" },
  fieldEmail: { es: "Correo", en: "Email" },
  fieldCompany: { es: "Empresa", en: "Company" },
  newValue: { es: "Nuevo valor", en: "New value" },

  // Builder — wait editor
  amount: { es: "Cantidad", en: "Amount" },
  unit: { es: "Unidad", en: "Unit" },
  unitSeconds: { es: "Segundos", en: "Seconds" },
  unitMinutes: { es: "Minutos", en: "Minutes" },
  unitHours: { es: "Horas", en: "Hours" },
  unitDays: { es: "Días", en: "Days" },
  // Live count of contacts currently parked at a wait step (shown on the card
  // when editing a saved automation).
  waitingNow: { es: "{n} esperando", en: "{n} waiting" },

  // Builder — send_webhook editor
  url: { es: "URL", en: "URL" },
  bodyTemplateJson: { es: "Plantilla del cuerpo (JSON)", en: "Body template (JSON)" },

  // Builder — condition fields
  conditionWhatToCheck: { es: "¿Qué quieres revisar?", en: "What do you want to check?" },
  conditionSubjectTagPresence: {
    es: "Si el contacto tiene una etiqueta",
    en: "Whether the contact has a tag",
  },
  conditionSubjectInSegment: {
    es: "Si está en un segmento",
    en: "Whether they're in a segment",
  },
  conditionSubjectContactField: {
    es: "Un dato del contacto",
    en: "A contact field",
  },
  conditionSubjectMessageContent: {
    es: "Lo que escribió el cliente",
    en: "What the customer wrote",
  },
  conditionSubjectTimeOfDay: { es: "La hora del día", en: "Time of day" },
  conditionSubjectContextVar: {
    es: "Un dato del pedido",
    en: "An order field",
  },
  segment: { es: "Segmento", en: "Segment" },
  chooseSegment: { es: "Elige un segmento…", en: "Choose a segment…" },
  field: { es: "Dato", en: "Field" },
  equals: { es: "Es igual a", en: "Equals" },
  messageContains: { es: "El mensaje contiene", en: "The message contains" },
  messageContainsPlaceholder: {
    es: "Ej: factura, cambio, reembolso",
    en: "e.g. invoice, exchange, refund",
  },
  betweenTheseHours: { es: "Entre estas horas", en: "Between these hours" },
  orderData: { es: "Dato del pedido", en: "Order field" },
  chooseData: { es: "Elige un dato…", en: "Choose a field…" },
  whenItIs: { es: "Cuando sea", en: "When it is" },
  repeatCustomerYes: { es: "Sí, ya compró antes", en: "Yes, bought before" },
  repeatCustomerNo: { es: "No, es su primera compra", en: "No, first purchase" },

  // Builder — order data option labels
  orderDataRepeatCustomer: {
    es: "¿Es cliente recurrente?",
    en: "Is a repeat customer?",
  },
  orderDataOfferChosen: { es: "Oferta que eligió", en: "Offer chosen" },
  orderDataTotalPrice: { es: "Total del pedido", en: "Order total" },
  orderDataItemCount: { es: "Cantidad de productos", en: "Item count" },
  orderDataFirstItem: { es: "Primer producto", en: "First item" },
  orderDataCurrency: { es: "Moneda", en: "Currency" },
  orderDataOrderNumber: { es: "Número de pedido", en: "Order number" },
  orderDataTrackingNumber: { es: "Número de seguimiento", en: "Tracking number" },

  // Builder — offer_chosen condition (repurchase flows)
  whichOffer: { es: "Qué oferta", en: "Which offer" },
  chooseOffer: { es: "Elige una oferta…", en: "Choose an offer…" },
  chooseValue: { es: "Elige un valor…", en: "Choose a value…" },
  offerChosenNoOffersHint: {
    es: "No hay ofertas configuradas. Define las unidades de cada oferta en la sección Productos, o escribe la etiqueta exacta.",
    en: "No offers configured yet. Set the units for each offer in the Products section, or type the exact label.",
  },
  whichProduct: { es: "Qué producto", en: "Which product" },
  chooseProduct: { es: "Elige un producto…", en: "Choose a product…" },
  productNoProductsHint: {
    es: "No hay productos sincronizados. Sincroniza tu tienda en la sección Productos, o escribe el nombre exacto.",
    en: "No products synced yet. Sync your store in the Products section, or type the exact name.",
  },

  // Builder — send_template variables editor
  templateVariables: { es: "Variables de la plantilla", en: "Template variables" },
  chooseVariable: { es: "Elige un dato…", en: "Choose a field…" },
  templateVarsUnmapped: {
    es: "Falta elegir el dato de algún espacio {{n}}, si lo dejas vacío, sale en blanco.",
    en: "Some {{n}} slots have no data chosen, left empty they render blank.",
  },
  varCustomerName: { es: "Nombre del cliente", en: "Customer name" },
  varOrderStatusUrl: { es: "Link de estado del pedido", en: "Order status link" },
  varTrackingUrl: { es: "Link de seguimiento", en: "Tracking link" },

  // Builder — step preview lines
  previewNoTextYet: { es: "sin texto aún", en: "no text yet" },
  previewChooseTemplate: { es: "elige una plantilla", en: "choose a template" },
  previewDefineWait: { es: "define cuánto esperar", en: "set how long to wait" },
  previewDefineCondition: { es: "define la condición", en: "set the condition" },
  previewNoUrl: { es: "sin URL", en: "no URL" },

  // Builder — wait preview units
  waitSecondOne: { es: "segundo", en: "second" },
  waitSecondOther: { es: "segundos", en: "seconds" },
  waitMinuteOne: { es: "minuto", en: "minute" },
  waitMinuteOther: { es: "minutos", en: "minutes" },
  waitHourOne: { es: "hora", en: "hour" },
  waitHourOther: { es: "horas", en: "hours" },
  waitDayOne: { es: "día", en: "day" },
  waitDayOther: { es: "días", en: "days" },

  // Builder — condition preview lines
  conditionPreviewTagPresence: { es: "según una etiqueta", en: "based on a tag" },
  conditionPreviewInSegment: { es: "según el segmento", en: "based on the segment" },
  conditionPreviewContactField: {
    es: "según un dato del contacto",
    en: "based on a contact field",
  },
  conditionPreviewMessageContent: {
    es: "según lo que escribió",
    en: "based on what they wrote",
  },
  conditionPreviewTimeOfDay: { es: "según la hora del día", en: "based on time of day" },
  conditionPreviewContextVar: {
    es: "según un dato del pedido",
    en: "based on an order field",
  },

  // Builder — canvas controls
  zoomOut: { es: "Reducir", en: "Zoom out" },
  zoomOutTitle: { es: "Reducir (Ctrl + rueda)", en: "Zoom out (Ctrl + wheel)" },
  zoomIn: { es: "Ampliar", en: "Zoom in" },
  zoomInTitle: { es: "Ampliar (Ctrl + rueda)", en: "Zoom in (Ctrl + wheel)" },
  center: { es: "Centrar", en: "Center" },
  centerAndFit: { es: "Centrar y ajustar", en: "Center and fit" },
  centerFlowTitle: { es: "Centrar todo el flujo", en: "Center the whole flow" },

  // Detail page — header + status
  eyebrow: { es: "Automatización", en: "Automation" },
  goBack: { es: "Volver", en: "Back" },
  notFound: { es: "Automatización no encontrada", en: "Automation not found" },
  notFoundShort: { es: "No encontrada", en: "Not found" },
  genericError: { es: "Error", en: "Error" },
  pause: { es: "Pausar", en: "Pause" },
  automationPaused: { es: "Automatización pausada", en: "Automation paused" },
  automationActivated: { es: "Automatización activada", en: "Automation activated" },

  // Detail page — metrics
  metricRuns: { es: "Ejecuciones", en: "Runs" },
  metricSuccess: { es: "Éxito", en: "Success" },
  metricPartial: { es: "Parciales", en: "Partial" },
  metricFailed: { es: "Fallidas", en: "Failed" },
  metricLast: { es: "Última", en: "Last" },

  // Detail page — charts
  runsPerDay: { es: "Ejecuciones por día", en: "Runs per day" },
  lastNDays: { es: "Últimos {n} días.", en: "Last {n} days." },
  howTheyEnded: { es: "Cómo terminaron", en: "How they ended" },
  runStatusCompleted: { es: "Completada", en: "Completed" },
  runStatusPartial: { es: "Parcial", en: "Partial" },
  runStatusFailed: { es: "Fallida", en: "Failed" },

  // Detail page — recent runs
  lastNRuns: { es: "Últimos {n} runs", en: "Last {n} runs" },
  viewAll: { es: "Ver todos", en: "View all" },
  notRunYet: {
    es: "Esta automatización todavía no ha corrido.",
    en: "This automation hasn't run yet.",
  },
  system: { es: "Sistema", en: "System" },
  stepsSuffix: { es: "{n} pasos", en: "{n} steps" },

  // Run journey (per-contact step-by-step trace, shown on stats + logs)
  journeyTitle: { es: "Recorrido", en: "Journey" },
  journeyTrigger: { es: "Se activó", en: "Triggered" },
  journeyStepSkipped: { es: "Omitido", en: "Skipped" },
  journeyWaited: { es: "Esperó {duration}", en: "Waited {duration}" },
  journeyWentTo: { es: "Fue por", en: "Went to" },

  // Logs page
  logsLoadFailed: {
    es: "No se pudieron cargar los registros",
    en: "Couldn't load the logs",
  },
  noRuns: { es: "Sin ejecuciones", en: "No runs" },
  unknownContact: { es: "Contacto desconocido", en: "Unknown contact" },
  stepCountOne: { es: "{n} paso", en: "{n} step" },
  stepCountOther: { es: "{n} pasos", en: "{n} steps" },
  noSteps: { es: "Sin pasos.", en: "No steps." },
  statusSuccessShort: { es: "éxito", en: "success" },
  statusPartialShort: { es: "parcial", en: "partial" },
  statusErrorShort: { es: "error", en: "error" },

  // Edit page
  loadFailedStatus: { es: "No se pudo cargar ({status})", en: "Couldn't load ({status})" },

  // Por qué una automatización todavía no se puede prender.
  // Salen por dos puertas —el editor y el chat del Operador— y las lee
  // un comercio: en inglés y en jerga no le dicen nada.
  issueSinPasos: { es: "Añade al menos un paso.", en: "Add at least one step." },
  issueSinTexto: { es: "Falta el texto del mensaje.", en: "The message text is missing." },
  issueSinPlantilla: { es: "Falta decir qué plantilla se manda.", en: "It does not say which template to send." },
  issueAbTest: { es: "La prueba A/B necesita dos plantillas y porcentajes que sumen 100%.", en: "The A/B test needs two templates and percentages that add up to 100%." },
  abTest: { es: "Prueba A/B", en: "A/B test" },
  abTraffic: { es: "Tráfico", en: "Traffic" },
  abTestHint: { es: "Cada contacto conserva su variante. Los porcentajes siempre suman 100%.", en: "Each contact keeps its variant. Percentages always add up to 100%." },
  abResults: { es: "Resultados", en: "Results" },
  abSent: { es: "Envíos", en: "Sent" },
  abReplies: { es: "Respuestas", en: "Replies" },
  abRate: { es: "Tasa", en: "Rate" },
  abOrders: { es: "Compras", en: "Orders" },
  abRevenue: { es: "Ingresos", en: "Revenue" },
  abPreviousPreview: { es: "Ver plantilla anterior", en: "Show previous template" },
  abNextPreview: { es: "Ver siguiente plantilla", en: "Show next template" },
  abMetricsLoading: { es: "Cargando métricas", en: "Loading metrics" },
  abMetricsUnavailable: { es: "No se pudieron cargar las métricas", en: "Metrics could not be loaded" },
  abMetricsSaveFirst: { es: "Guarda la automatización para ver las métricas", en: "Save the automation to view metrics" },
  issuePlantillaNoAprobada: { es: "Las plantillas deben estar aprobadas por Meta antes de activar.", en: "Templates must be approved by Meta before activation." },
  issueMercadoPagoPendiente: { es: "Conecta Mercado Pago antes de activar esta automatización.", en: "Connect Mercado Pago before activating this automation." },
  issueWhatsAppPagoPendiente: { es: "Meta requiere agregar un método de pago para enviar mensajes proactivos por WhatsApp.", en: "Meta requires a payment method to send proactive WhatsApp messages." },
  issueWhatsAppNoDisponible: { es: "WhatsApp no está listo para enviar mensajes proactivos.", en: "WhatsApp is not ready to send proactive messages." },
  issueSinEtiqueta: { es: "Falta elegir la etiqueta.", en: "Pick a tag." },
  issueEtiquetaRara: { es: "Esa etiqueta no existe en tu cuenta.", en: "That tag does not exist in your account." },
  issueSinAgente: { es: "Falta elegir a quién se le asigna.", en: "Pick who it gets assigned to." },
  issueSinCampo: { es: "Falta decir qué dato se guarda.", en: "It does not say which field to store." },
  issueSinValor: { es: "Falta el valor que se guarda.", en: "The value to store is missing." },
  issueEsperaCero: { es: "La espera tiene que ser de más de cero.", en: "The wait has to be longer than zero." },
  issueEsperaUnidad: { es: "La espera se mide en segundos, minutos, horas o días.", en: "Waits are measured in seconds, minutes, hours or days." },
  issueSinDato: { es: "Falta decir por qué dato pregunta.", en: "It does not say what the question is about." },
  issueOperandoRaro: { es: "Esa etiqueta o segmento no existe en tu cuenta.", en: "That tag or segment does not exist in your account." },
  issueSinOperando: { es: "Falta con qué se compara.", en: "It does not say what to compare against." },
  issueSinValorCondicion: { es: "Falta elegir el valor de la condición.", en: "Choose the condition value." },
  fixHighlightedStep: { es: "Completa la tarjeta resaltada.", en: "Complete the highlighted card." },
  issueSinUrl: { es: "Falta la dirección a la que avisar.", en: "The address to notify is missing." },
  issueUrlProtocolo: { es: "La dirección tiene que empezar con http o https.", en: "The address has to start with http or https." },
  issueUrlInvalida: { es: "Esa dirección no es válida.", en: "That address is not valid." },
  issueSinAgenteVoz: { es: "Falta elegir qué agente llama.", en: "Pick which agent places the call." },
  issueSinObjetivoVoz: { es: "Describe el objetivo personalizado de la llamada.", en: "Describe the custom call objective." },
  issueSinPalabras: { es: "Hace falta al menos una palabra clave.", en: "At least one keyword is required." },
  issuePalabrasVacias: { es: "Hay palabras clave vacías.", en: "Some keywords are empty." },
  issueCoincidencia: { es: "La coincidencia es exacta o contiene.", en: "Matching is either exact or contains." },
} satisfies Namespace;
