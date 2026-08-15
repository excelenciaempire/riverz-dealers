import type { Namespace } from "./types";

/** Automations: list/gallery, builder canvas, trigger/step config, detail + run logs. */
export const automations = {
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
    es: "A los 15 minutos de abandonar el carrito, si todavía no compró, le mandamos el link para retomarlo.",
    en: "15 minutes after the cart is abandoned, if they still haven't purchased, we send the link to pick it back up.",
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
    es: "Confirmamos al cliente apenas hace un pedido en Shopify. Le mandamos un resumen con el número de orden, el total y un agradecimiento.",
    en: "We confirm with the customer the moment they place an order on Shopify. We send a summary with the order number, the total and a thank-you.",
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
    es: "No hay un WhatsApp conectado — no podrá enviar mensajes.",
    en: "No WhatsApp connected — it won't be able to send messages.",
  },

  // Builder — live preview rail
  preview: { es: "Vista previa", en: "Preview" },
  closePreview: { es: "Cerrar vista previa", en: "Close preview" },
  templateLabel: { es: "Plantilla: {name}", en: "Template: {name}" },
  selectTemplatePlaceholder: {
    es: "Selecciona una plantilla…",
    en: "Select a template…",
  },
  addMessageStepHint: {
    es: "Añade un paso de mensaje para ver la vista previa.",
    en: "Add a message step to see the preview.",
  },

  // Builder — trigger card
  triggerEyebrow: { es: "Activador", en: "Trigger" },
  triggerEyebrowShopify: { es: "Activador · Shopify", en: "Trigger · Shopify" },
  triggerTagAdded: { es: "Etiqueta añadida", en: "Tag added" },
  triggerShopifyOrderCreated: { es: "Nuevo pedido (Shopify)", en: "New order (Shopify)" },
  triggerShopifyOrderPaid: {
    es: "Pedido pagado (Shopify)",
    en: "Order paid (Shopify)",
  },
  triggerShopifyOrderFulfilled: {
    es: "Pedido despachado (Shopify)",
    en: "Order fulfilled (Shopify)",
  },
  triggerShopifyOrderDelivered: {
    es: "Pedido entregado (Shopify)",
    en: "Order delivered (Shopify)",
  },
  triggerShopifyOrderCancelled: {
    es: "Pedido cancelado (Shopify)",
    en: "Order cancelled (Shopify)",
  },
  triggerShopifyOrderRefunded: {
    es: "Pedido reembolsado (Shopify)",
    en: "Order refunded (Shopify)",
  },
  triggerShopifyAbandonedCheckout: {
    es: "Carrito abandonado (Shopify)",
    en: "Abandoned checkout (Shopify)",
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
  stepSendTemplate: { es: "Enviar plantilla", en: "Send template" },
  stepAddTag: { es: "Añadir etiqueta", en: "Add tag" },
  stepRemoveTag: { es: "Quitar etiqueta", en: "Remove tag" },
  stepAssignConversation: { es: "Asignar conversación", en: "Assign conversation" },
  stepUpdateContactField: {
    es: "Actualizar campo del contacto",
    en: "Update contact field",
  },
  stepWait: { es: "Esperar", en: "Wait" },
  stepCondition: { es: "Condición (Sí / No)", en: "Condition (Yes / No)" },
  stepSwitch: { es: "Condición", en: "Condition" },
  stepSendWebhook: { es: "Enviar webhook", en: "Send webhook" },
  stepCloseConversation: { es: "Cerrar conversación", en: "Close conversation" },
  stepVoiceCall: { es: "Llamar con IA", en: "Call with AI" },

  // Builder — voice_call step config
  voiceCallAgent: { es: "Agente de voz", en: "Voice agent" },
  voiceCallPickAgent: { es: "Elige un agente…", en: "Pick an agent…" },
  voiceCallNoAgents: {
    es: "No hay agentes con voz activada. Actívala en Asistente → Voz.",
    en: "No voice-enabled agents. Turn it on in Assistant → Voice.",
  },
  voiceCallNoAgentsShort: {
    es: "Ningún agente tiene voz activada.",
    en: "No agent has voice enabled.",
  },
  voiceCallObjective: { es: "Objetivo (opcional)", en: "Objective (optional)" },
  voiceCallObjectivePlaceholder: {
    es: "Ej: confirmar la dirección de envío y el método de pago.",
    en: "E.g. confirm the shipping address and payment method.",
  },
  voiceCallWait: {
    es: "Esperar el resultado",
    en: "Wait for the result",
  },
  voiceCallWaitHint: {
    es: "Los pasos siguientes corren cuando la llamada termina, y pueden decidir según cómo salió.",
    en: "The next steps run once the call ends, and can branch on how it went.",
  },
  voiceCallPreview: { es: "Llamada con IA", en: "AI call" },
  voiceCallPreviewWaiting: {
    es: "Llamada con IA · espera el resultado",
    en: "AI call · waits for the result",
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
    es: "Un dato del pedido (Shopify)",
    en: "An order field (Shopify)",
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
  timeRangeHint: { es: "Desde-hasta, en formato 24 h.", en: "From-to, in 24h format." },
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
  templateVariablesHint: {
    es: "El contenido de la plantilla se edita en Plantillas. Aquí solo eliges qué dato va en cada espacio ({{n}}).",
    en: "Template content is edited in Templates. Here you only choose which data fills each slot ({{n}}).",
  },
  templateVarsUnmapped: {
    es: "Falta elegir el dato de algún espacio {{n}} — si lo dejas vacío, sale en blanco.",
    en: "Some {{n}} slots have no data chosen — left empty they render blank.",
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
} satisfies Namespace;
