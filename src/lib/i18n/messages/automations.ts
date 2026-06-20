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
  save: { es: "Guardar", en: "Save" },
  saveDraft: { es: "Guardar borrador", en: "Save draft" },
  useTemplate: { es: "Usar plantilla", en: "Use template" },
  saveFailed: { es: "No se pudo guardar", en: "Couldn't save" },
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
  triggerShopifyOrderFulfilled: {
    es: "Pedido despachado (Shopify)",
    en: "Order fulfilled (Shopify)",
  },
  triggerShopifyAbandonedCheckout: {
    es: "Carrito abandonado (Shopify)",
    en: "Abandoned checkout (Shopify)",
  },
  cronOrTimePlaceholder: { es: "Expresión cron o HH:mm", en: "Cron expression or HH:mm" },

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
  stepCondition: { es: "Condición (Si / Si no)", en: "Condition (If / Else)" },
  stepSendWebhook: { es: "Enviar webhook", en: "Send webhook" },
  stepCloseConversation: { es: "Cerrar conversación", en: "Close conversation" },

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
  whichField: { es: "¿Qué dato?", en: "Which field?" },
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
  orderDataTotalPrice: { es: "Total del pedido", en: "Order total" },
  orderDataItemCount: { es: "Cantidad de productos", en: "Item count" },
  orderDataFirstItem: { es: "Primer producto", en: "First item" },
  orderDataCurrency: { es: "Moneda", en: "Currency" },
  orderDataOrderNumber: { es: "Número de pedido", en: "Order number" },
  orderDataTrackingNumber: { es: "Número de seguimiento", en: "Tracking number" },

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
