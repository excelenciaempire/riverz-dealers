import type { Namespace } from "./types";

/** WhatsApp templates: list, detail, and the builder form. */
export const templates = {
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
  variableSamplePlaceholder: { es: "María", en: "Jane" },
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
} satisfies Namespace;
