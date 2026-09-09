import type { Namespace } from "./types";

/** WhatsApp templates: list, detail, and the builder form. */
export const templates = {
  viewStats: { es: "Ver estadísticas", en: "View stats" },
  // ── Categories ──
  categoryMarketing: { es: "Marketing", en: "Marketing" },
  categoryUtility: { es: "Utilidad", en: "Utility" },
  categoryAuthentication: { es: "Autenticación", en: "Authentication" },
  categoryMarketingHint: {
    es: "Promociones, novedades, ofertas y campañas. Requiere consentimiento del contacto.",
    en: "Promotions, news, offers and campaigns. Requires the contact's consent.",
  },
  categoryUtilityHint: {
    es: "Mensajes operativos en respuesta a una acción: confirmaciones, envíos, recordatorios, recibos.",
    en: "Operational messages in response to an action: confirmations, shipping, reminders, receipts.",
  },
  categoryAuthenticationHint: {
    es: "Códigos de verificación de un solo uso (OTP) para iniciar sesión o validar la identidad.",
    en: "One-time verification codes (OTP) to sign in or verify identity.",
  },

  // ── Header types ──
  headerNone: { es: "Sin encabezado", en: "No header" },
  headerTextOption: { es: "Texto", en: "Text" },

  // ── Languages ──
  languageEs: { es: "Español", en: "Spanish" },
  languageEsAr: { es: "Español (Argentina)", en: "Spanish (Argentina)" },
  languageEsEs: { es: "Español (España)", en: "Spanish (Spain)" },
  languageEsMx: { es: "Español (México)", en: "Spanish (Mexico)" },
  languageEn: { es: "Inglés", en: "English" },
  languageEnUs: { es: "Inglés (EE. UU.)", en: "English (US)" },
  languageEnGb: { es: "Inglés (Reino Unido)", en: "English (UK)" },
  languagePtBr: { es: "Portugués (Brasil)", en: "Portuguese (Brazil)" },
  languagePtPt: { es: "Portugués (Portugal)", en: "Portuguese (Portugal)" },
  languageFr: { es: "Francés", en: "French" },
  languageDe: { es: "Alemán", en: "German" },
  languageIt: { es: "Italiano", en: "Italian" },

  // ── Button types ──
  buttonQuickReply: { es: "Respuesta rápida", en: "Quick reply" },
  buttonQuickReplyHint: {
    es: "Botón que envía un texto de vuelta cuando el contacto lo toca.",
    en: "Button that sends a text back when the contact taps it.",
  },
  buttonUrl: { es: "Enlace (URL)", en: "Link (URL)" },
  buttonUrlHint: { es: "Abre una página web al tocarlo.", en: "Opens a web page when tapped." },
  buttonPhone: { es: "Llamar por teléfono", en: "Call phone number" },
  buttonPhoneHint: {
    es: "Inicia una llamada al número que indiques.",
    en: "Starts a call to the number you specify.",
  },

  // ── Builder ──
  newTemplate: { es: "Nueva plantilla", en: "New template" },
  fieldName: { es: "Nombre", en: "Name" },
  namePlaceholder: { es: "recordatorio_constancia", en: "reminder_followup" },
  fieldLanguage: { es: "Idioma", en: "Language" },
  fieldCategory: { es: "Categoría", en: "Category" },
  categoryTooltip: {
    es: "Qué significa cada categoría",
    en: "What each category means",
  },
  fieldHeader: { es: "Encabezado", en: "Header" },
  fieldMessage: { es: "Mensaje", en: "Message" },
  addVariable: { es: "Añadir variable", en: "Add variable" },
  messagePlaceholder: {
    es: "Escribe el mensaje. Usa {{1}}, {{2}} para datos variables.",
    en: "Write the message. Use {{1}}, {{2}} for variable data.",
  },
  variableSamplePlaceholder: { es: "Ejemplo (ej. María)", en: "Example (e.g. Jane)" },
  variableCustom: { es: "Valor personalizado", en: "Custom value" },
  fieldFooter: { es: "Pie", en: "Footer" },
  footerPlaceholder: { es: "Equipo Vitalú", en: "Your team" },
  buttonsLabel: { es: "Botones", en: "Buttons" },
  addButton: { es: "Añadir botón", en: "Add button" },
  cancel: { es: "Cancelar", en: "Cancel" },
  sending: { es: "Enviando…", en: "Sending…" },
  sendToMeta: { es: "Enviar a Meta", en: "Send to Meta" },
  buttonTextPlaceholder: { es: "Texto del botón", en: "Button text" },
  removeButton: { es: "Quitar botón", en: "Remove button" },
  urlPlaceholder: { es: "tu-pagina.com/oferta", en: "your-site.com/offer" },
  phonePlaceholder: { es: "+57 300 000 0000", en: "+1 555 000 0000" },

  // ── Botón URL: enlace fijo vs link variable de Shopify ──
  buttonUrlModeCustom: { es: "Enlace fijo", en: "Fixed link" },
  buttonUrlVariableHint: {
    es: "Se completa con el link de cada cliente al enviar.",
    en: "Filled with each customer's link on send.",
  },
  linkVarAbandonedCheckout: {
    es: "Recuperar carrito",
    en: "Recover cart",
  },
  linkVarOrderStatus: { es: "Estado del pedido", en: "Order status" },
  linkVarTracking: { es: "Seguimiento del envío", en: "Shipment tracking" },
  linkVarProduct: { es: "Producto", en: "Product" },

  // ── Builder toasts / validation ──
  fixErrorsBeforeSending: {
    es: "Corrige {count} {errorWord} antes de enviar a Meta.",
    en: "Fix {count} {errorWord} before sending to Meta.",
  },
  errorSingular: { es: "error", en: "error" },
  errorPlural: { es: "errores", en: "errors" },
  missingName: { es: "Falta el nombre.", en: "Name is missing." },
  missingMessage: { es: "Falta el mensaje.", en: "Message is missing." },
  createFailed: { es: "No se pudo crear la plantilla", en: "Could not create the template" },
  templateSent: { es: "Plantilla enviada", en: "Template sent" },

  // ── Issues panel ──
  errorsBlockSendingSingular: {
    es: "{count} error bloquea el envío",
    en: "{count} error is blocking submission",
  },
  errorsBlockSendingPlural: {
    es: "{count} errores bloquean el envío",
    en: "{count} errors are blocking submission",
  },
  suggestionsBeforeSendingSingular: {
    es: "{count} sugerencia antes de enviar",
    en: "{count} suggestion before sending",
  },
  suggestionsBeforeSendingPlural: {
    es: "{count} sugerencias antes de enviar",
    en: "{count} suggestions before sending",
  },
  andWarningsSingular: { es: " y {count} advertencia", en: " and {count} warning" },
  andWarningsPlural: { es: " y {count} advertencias", en: " and {count} warnings" },

  // ── Preview ──
  yourBusiness: { es: "Tu negocio", en: "Your business" },
  messageAppearsHere: { es: "Tu mensaje aparece aquí…", en: "Your message appears here…" },

  // ── List page ──
  statusDraft: { es: "Borrador", en: "Draft" },
  statusPending: { es: "Pendiente", en: "Pending" },
  statusApproved: { es: "Aprobada", en: "Approved" },
  statusRejected: { es: "Rechazada", en: "Rejected" },
  // Calidad / pacing de la plantilla
  paused: { es: "Pausada", en: "Paused" },
  qualityRed: { es: "Calidad baja", en: "Low quality" },
  qualityYellow: { es: "Calidad media", en: "Medium quality" },
  qualityUnknown: { es: "Sin datos", en: "No data yet" },
  pacingHint: {
    es: "Plantilla nueva: WhatsApp puede retener los primeros envíos para evaluar su calidad.",
    en: "New template: WhatsApp may hold the first sends to assess its quality.",
  },
  whatsappTemplates: { es: "Plantillas de WhatsApp", en: "WhatsApp templates" },
  syncing: { es: "Sincronizando…", en: "Syncing…" },
  sync: { es: "Sincronizar", en: "Sync" },
  loadFailed: { es: "No se cargaron las plantillas", en: "Could not load templates" },
  syncFailedDefault: { es: "Sincronización fallida", en: "Sync failed" },
  syncCouldNot: { es: "No se pudo sincronizar", en: "Could not sync" },
  syncedFromMetaSingular: {
    es: "{count} plantilla sincronizada desde Meta",
    en: "{count} template synced from Meta",
  },
  syncedFromMetaPlural: {
    es: "{count} plantillas sincronizadas desde Meta",
    en: "{count} templates synced from Meta",
  },
  templateDeleted: { es: "Plantilla eliminada", en: "Template deleted" },
  deleteFailed: { es: "No se pudo eliminar", en: "Could not delete" },
  emptyTitle: { es: "Todavía no tienes plantillas", en: "You don't have any templates yet" },
  emptyDescription: {
    es: "Crea una nueva o sincronízalas desde Meta.",
    en: "Create a new one or sync them from Meta.",
  },
  searchPlaceholder: { es: "Buscar plantilla…", en: "Search templates…" },
  columnName: { es: "Nombre", en: "Name" },
  columnCategory: { es: "Categoría", en: "Category" },
  columnMessage: { es: "Mensaje", en: "Message" },
  columnStatus: { es: "Estado", en: "Status" },
  columnUpdated: { es: "Actualizada", en: "Updated" },
  noMatches: {
    es: "No encontramos plantillas que coincidan con “{query}”.",
    en: "No templates match “{query}”.",
  },
  deleteTemplateAria: { es: "Eliminar plantilla", en: "Delete template" },
  deleteConfirm: {
    es: "Se elimina «{name}» de esta cuenta y de WhatsApp. No se puede deshacer.",
    en: "«{name}» will be deleted from this account and from WhatsApp. This cannot be undone.",
  },

  // ── Detail page ──
  templateNotFound: { es: "Plantilla no encontrada", en: "Template not found" },
  genericError: { es: "Error", en: "Error" },
  back: { es: "Volver", en: "Back" },
  whatsappTemplate: { es: "Plantilla de WhatsApp", en: "WhatsApp template" },
  createdOn: { es: "Creada el {date}", en: "Created on {date}" },
  delete: { es: "Eliminar", en: "Delete" },
  preview: { es: "Vista previa", en: "Preview" },
  previewHintWithSamples: {
    es: "Los valores resaltados son ejemplos; se reemplazan al enviar.",
    en: "Highlighted values are examples; they're replaced when sending.",
  },
  previewHintNoSamples: {
    es: "Los {{n}} se reemplazan al enviar.",
    en: "The {{n}} placeholders are replaced when sending.",
  },
  variableTitle: { es: "Variable {{{n}}}", en: "Variable {{{n}}}" },
  whatEachVariableReplaces: {
    es: "Qué reemplaza cada variable:",
    en: "What each variable replaces:",
  },
  buttonLinkPerCustomer: {
    es: "enlace propio de cada cliente",
    en: "each customer's own link",
  },
  dynamicValueHint: {
    es: "valor dinámico (define un ejemplo al crearla)",
    en: "dynamic value (set an example when creating it)",
  },
  metaApproval: { es: "Aprobación de Meta", en: "Meta approval" },
  approvalApproved: {
    es: "Aprobada. Puedes usarla en campañas masivas y mensajes fuera de la ventana de 24h.",
    en: "Approved. You can use it in bulk campaigns and messages outside the 24h window.",
  },
  approvalPending: {
    es: "Pendiente de revisión por Meta. Suele tardar entre 5 min y 24h.",
    en: "Pending review by Meta. It usually takes between 5 min and 24h.",
  },
  approvalRejected: {
    es: "Rechazada por Meta. Revisa las reglas de plantillas (no promesas exageradas, no contenido restringido) y vuelve a enviarla.",
    en: "Rejected by Meta. Review the template rules (no exaggerated promises, no restricted content) and resubmit it.",
  },
  approvalDraft: {
    es: "Es un borrador. Envíala a aprobar desde Meta para poder usarla en envíos masivos.",
    en: "It's a draft. Submit it to Meta for approval so you can use it in bulk sends.",
  },
  viewInMetaBusiness: { es: "Ver en Meta Business", en: "View in Meta Business" },
  metricsTitle: { es: "Métricas", en: "Metrics" },
  metricsPeriod: { es: "Últimos 30 días", en: "Last 30 days" },
  metricsLoading: { es: "Cargando métricas…", en: "Loading metrics…" },
  metricsUnavailable: {
    es: "Sin métricas todavía (aparecen cuando la plantilla se envía).",
    en: "No metrics yet (they show once the template is sent).",
  },
  metricSent: { es: "Enviados", en: "Sent" },
  metricDelivered: { es: "Entregados", en: "Delivered" },
  metricRead: { es: "Leídos", en: "Read" },
  metricClicks: { es: "Clics en botón", en: "Button clicks" },
  metricCtr: { es: "{pct} de entregados", en: "{pct} of delivered" },
  metricCartTitle: { es: "Recuperación de carrito", en: "Cart recovery" },
  metricCartRecovered: { es: "Compras recuperadas", en: "Purchases recovered" },
  metricCartRevenue: { es: "Ingreso recuperado", en: "Recovered revenue" },
  metricCartBuyers: {
    es: "Compraron tras recibir el mensaje:",
    en: "Bought after receiving the message:",
  },
  metricCartBuyerUnknown: { es: "Cliente sin nombre", en: "Unnamed customer" },
  metricCartRate: { es: "Tasa de conversión", en: "Conversion rate" },
  metricCartRateSub: {
    es: "{converted} de {reached} que lo recibieron",
    en: "{converted} of {reached} who received it",
  },
  metricsUpdatedAt: { es: "Actualizado {time}", en: "Updated {time}" },
  usedIn: { es: "Usada en", en: "Used in" },

  // ── Layout ──
  connectToManage: {
    es: "Conecta WhatsApp para gestionar plantillas",
    en: "Connect WhatsApp to manage templates",
  },
  connectDescription: {
    es: "Las plantillas se envían a Meta para su aprobación.",
    en: "Templates are sent to Meta for approval.",
  },
  connectWhatsapp: { es: "Conectar WhatsApp", en: "Connect WhatsApp" },

  // ── Live validation messages (template-validate.ts → builder issues panel) ──
  tplValidate_name_required: {
    es: "Escribe un nombre para la plantilla.",
    en: "Enter a name for the template.",
  },
  tplValidate_name_too_long: {
    es: "El nombre pasa de {max} caracteres.",
    en: "The name exceeds {max} characters.",
  },
  tplValidate_name_format: {
    es: "El nombre solo admite letras minúsculas, números y guion bajo (ej: confirmacion_pedido).",
    en: "The name only allows lowercase letters, numbers and underscores (e.g. order_confirmation).",
  },
  tplValidate_language_required: {
    es: "Elige el idioma de la plantilla.",
    en: "Choose the template's language.",
  },
  tplValidate_header_empty: {
    es: "El encabezado de texto está vacío.",
    en: "The text header is empty.",
  },
  tplValidate_header_too_long: {
    es: "El encabezado pasa de {max} caracteres ({len} actuales).",
    en: "The header exceeds {max} characters ({len} now).",
  },
  tplValidate_header_too_many_vars: {
    es: "El encabezado solo puede tener una variable.",
    en: "The header can only have one variable.",
  },
  tplValidate_body_required: {
    es: "Escribe el texto del cuerpo de la plantilla.",
    en: "Enter the template body text.",
  },
  tplValidate_body_too_long: {
    es: "El cuerpo pasa de {max} caracteres ({len} actuales).",
    en: "The body exceeds {max} characters ({len} now).",
  },
  tplValidate_body_samples_missing: {
    es: "Falta un valor de ejemplo para {vars}. Meta lo necesita para aprobar la plantilla.",
    en: "A sample value is missing for {vars}. Meta needs it to approve the template.",
  },
  tplValidate_body_whitespace: {
    es: "El cuerpo no puede empezar ni terminar con espacios o saltos de línea.",
    en: "The body can't start or end with spaces or line breaks.",
  },
  tplValidate_body_var_at_edge: {
    es: "El cuerpo no puede empezar ni terminar con una variable. Agrega texto antes o después de {{1}}.",
    en: "The body can't start or end with a variable. Add text before or after {{1}}.",
  },
  tplValidate_body_pattern_repeated: {
    es: "Evita signos repetidos (??, !!, $$). Meta los rechaza por considerarlos spam.",
    en: "Avoid repeated symbols (??, !!, $$). Meta rejects them as spam.",
  },
  tplValidate_body_pattern_caps: {
    es: "Evita palabras en mayúsculas largas. Meta lo lee como grito y suele rechazar.",
    en: "Avoid long all-caps words. Meta reads them as shouting and often rejects.",
  },
  tplValidate_footer_too_long: {
    es: "El pie pasa de {max} caracteres ({len} actuales).",
    en: "The footer exceeds {max} characters ({len} now).",
  },
  tplValidate_footer_no_vars: {
    es: "El pie de página no admite variables.",
    en: "The footer can't contain variables.",
  },
  tplValidate_too_many_buttons: {
    es: "Meta acepta hasta {max} botones por plantilla.",
    en: "Meta allows up to {max} buttons per template.",
  },
  tplValidate_too_many_reply: {
    es: "Hasta {max} botones de respuesta rápida.",
    en: "Up to {max} quick-reply buttons.",
  },
  tplValidate_too_many_url: {
    es: "Hasta {max} botones con URL.",
    en: "Up to {max} URL buttons.",
  },
  tplValidate_too_many_phone: {
    es: "Solo se permite un botón de llamada.",
    en: "Only one call button is allowed.",
  },
  tplValidate_mixed_buttons: {
    es: "No puedes mezclar botones de respuesta rápida con botones de URL o teléfono. Elige una sola modalidad.",
    en: "You can't mix quick-reply buttons with URL or phone buttons. Pick a single type.",
  },
  tplValidate_button_text_empty: {
    es: "El botón {n} no tiene texto.",
    en: "Button {n} has no text.",
  },
  tplValidate_button_text_too_long: {
    es: "El texto del botón {n} pasa de {max} caracteres.",
    en: "Button {n}'s text exceeds {max} characters.",
  },
  tplValidate_button_url_https: {
    es: "El botón {n} debe usar una URL con https://.",
    en: "Button {n} must use an https:// URL.",
  },
  tplValidate_button_phone_format: {
    es: "El teléfono del botón {n} debe estar en formato internacional (ej: +573001234567).",
    en: "Button {n}'s phone must be in international format (e.g. +573001234567).",
  },
  tplValidate_marketing_no_cta: {
    es: "Las plantillas de Marketing convierten mucho mejor con al menos un botón. Considera agregar uno.",
    en: "Marketing templates convert much better with at least one button. Consider adding one.",
  },
  tplValidate_auth_no_code: {
    es: "Las plantillas de Autenticación suelen incluir el código OTP en el cuerpo. ¿Olvidaste la variable?",
    en: "Authentication templates usually include the OTP code in the body. Did you forget the variable?",
  },
} satisfies Namespace;
