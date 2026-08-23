import type { Namespace } from "./types";

/**
 * Merchant-facing API error + display strings for the inbox/analytics route
 * handlers (assignment-rules, saved filters, conversation search, Shopify
 * attribution). These are returned as JSON { error: "..." } and surfaced in
 * the dashboard, or used as fallback display names in attribution/search
 * results, so they must follow the merchant's locale.
 */
export const errInbox = {
  // Assignment rules (POST/DELETE) validation + role guards
  missingRuleFields: {
    es: "Faltan name, kind o workspace_id",
    en: "Missing name, kind or workspace_id",
  },
  rulesAdminsOnly: {
    es: "Solo admins/owners pueden modificar reglas",
    en: "Only admins/owners can modify rules",
  },
  missingIdOrWorkspace: {
    es: "Faltan id o workspace_id",
    en: "Missing id or workspace_id",
  },

  // Saved filters validation
  missingName: { es: "Falta name", en: "Missing name" },
  missingId: { es: "Falta id", en: "Missing id" },

  // Search — fallback contact display name
  contactFallback: { es: "Contacto", en: "Contact" },

  // Attribution — fallback entity display names
  broadcastFallback: { es: "Campaña", en: "Campaign" },
  flowFallback: { es: "Flujo", en: "Flow" },
  automationFallback: { es: "Automatización", en: "Automation" },
  agentFallback: { es: "Asistente", en: "Assistant" },
  igCampaignFallback: { es: "Campaña IG", en: "IG campaign" },

  // Shared auth / membership guards (returned across inbox + channel routes)
  unauthorized: { es: "No autorizado", en: "Unauthorized" },
  notSignedIn: { es: "No has iniciado sesión", en: "Not signed in" },
  forbidden: { es: "No tienes permiso", en: "Forbidden" },
  forbiddenAdminOnly: { es: "Prohibido — solo administradores", en: "Forbidden — admin only" },
  noWorkspace: { es: "Sin espacio de trabajo", en: "No workspace" },
  adminOnly: { es: "Solo administradores", en: "Admins only" },
  sendFailed: { es: "No se pudo enviar", en: "Couldn't send" },

  // Shared resource guards
  missingIdGeneric: { es: "Falta el id", en: "Missing id" },
  notFound: { es: "No encontrado", en: "Not found" },
  orphanMessage: { es: "Mensaje huérfano", en: "Orphan message" },
  notAuthenticated: { es: "No autenticado", en: "Not authenticated" },

  // messages/send — outbound send validation + routing
  sendMissingFields: {
    es: "Se requieren conversation_id y texto",
    en: "conversation_id and text are required",
  },
  conversationNotFound: { es: "Conversación no encontrada", en: "Conversation not found" },

  // comments/dm — escribirle al privado a quien comentó
  empty_text: { es: "Escribe un mensaje", en: "Write a message" },
  message_not_found: { es: "Comentario no encontrado", en: "Comment not found" },
  not_a_comment: {
    es: "Esto no es un comentario",
    en: "This isn't a comment",
  },
  conversation_not_found: {
    es: "Conversación no encontrada",
    en: "Conversation not found",
  },
  contact_not_found: { es: "Contacto no encontrado", en: "Contact not found" },
  channel_not_connected: {
    es: "Conecta la cuenta para poder escribir al privado",
    en: "Connect the account to send DMs",
  },
  no_recipient: {
    es: "Esta persona no se puede contactar por privado",
    en: "This person can't be reached by DM",
  },
  templateUnsupported: {
    es: "Este canal no admite plantillas",
    en: "This channel does not support templates",
  },
  // El botón lleva el enlace de ESE cliente y solo lo sabe el disparador de la
  // automatización. Meta la rechazaba con "(#131008) Required parameter is
  // missing", que no explica nada.
  templateDynamicLink: {
    es: "Esta plantilla se envía automáticamente: su botón lleva un enlace distinto para cada cliente.",
    en: "This template is sent automatically: its button carries a different link for each customer.",
  },
  contactNotFound: { es: "Contacto no encontrado", en: "Contact not found" },
  uploadInvalid: { es: "Archivo o conversación inválidos", en: "Invalid file or conversation" },
  uploadTooLarge: { es: "El archivo supera 25 MB", en: "File exceeds 25 MB" },
  uploadFailed: { es: "No se pudo subir el archivo", en: "Couldn't upload the file" },
  mediaUnsupported: {
    es: "Este canal no admite archivos adjuntos",
    en: "This channel doesn't support attachments",
  },
  attachmentUnreadable: {
    es: "No se pudo leer el archivo adjunto",
    en: "Couldn't read the attached file",
  },
  attachmentTooLargeGraph: {
    es: "Outlook admite hasta 3 MB por adjunto",
    en: "Outlook allows up to 3 MB per attachment",
  },
  attachmentQuestionUnsupported: {
    es: "Las preguntas de Mercado Libre solo admiten texto",
    en: "Mercado Libre questions only support text",
  },
  mediaUnsupportedInstagram: {
    es: "Instagram solo admite imagen, video y audio por mensaje directo",
    en: "Instagram only supports image, video and audio in direct messages",
  },
  conversationNoConnection: {
    es: "La conversación no tiene una conexión",
    en: "Conversation has no connection",
  },
  connectionNotFound: { es: "Conexión no encontrada", en: "Connection not found" },

  // messages/moderate — FB/IG comment moderation
  moderateMissingFields: {
    es: "Se requieren message_id y action",
    en: "message_id and action are required",
  },
  messageNotFound: { es: "Mensaje no encontrado", en: "Message not found" },
  tiktokRepeatedReply: {
    es: "Esta misma respuesta ya salió {veces} veces esta semana. TikTok suele ocultar las repetidas: usa el botón de generar respuesta para que cada una sea distinta.",
    en: "This same reply already went out {veces} times this week. TikTok tends to hide repeats — use the draft button so each one is different.",
  },
  moderateOnlyComments: {
    es: "La moderación solo aplica a comentarios de Facebook o Instagram",
    en: "Moderation only applies to Facebook or Instagram comments",
  },
  commentNoExternalId: {
    es: "El comentario no tiene un id externo",
    en: "Comment has no external id",
  },
  graphCallFailed: {
    es: "La llamada a Meta falló",
    en: "The call to Meta failed",
  },

  // conversations/:id PATCH
  aiEnabledRequired: {
    es: "Se requiere ai_enabled (booleano)",
    en: "ai_enabled (boolean) is required",
  },

  // connections/meta/manual + sdk-connect + whatsapp embedded-signup
  metaManualMissingFields: {
    es: "Se requieren channel, token y workspace_id",
    en: "channel, token and workspace_id are required",
  },
  channelNotSupported: { es: "Canal no compatible", en: "Channel not supported" },
  sdkConnectMissingFields: {
    es: "Se requieren channel, workspace_id y (code o access_token)",
    en: "channel, workspace_id and (code or access_token) are required",
  },
  invalidChannel: { es: "Canal inválido", en: "Invalid channel" },
  metaAppNotConfigured: {
    es: "La app de Meta no está configurada",
    en: "Meta app is not configured",
  },
  metaConnectionFailed: { es: "La conexión falló", en: "Connection failed" },
  embeddedSignupMissingFields: {
    es: "Se requieren code, waba_id, phone_number_id y workspace_id",
    en: "code, waba_id, phone_number_id and workspace_id are required",
  },
  whatsappAlreadyConnected: {
    es: "Ya tienes un WhatsApp conectado ({label}). Desconéctalo antes de conectar otro número.",
    en: "You already have a WhatsApp connected ({label}). Disconnect it before connecting another number.",
  },

  // connections/:provider/oauth/start
  unknownProvider: { es: "Proveedor desconocido", en: "Unknown provider" },
  workspaceAndChannelRequired: {
    es: "Se requieren workspace_id y channel",
    en: "workspace_id and channel are required",
  },
  providerNotConfigured: {
    es: "Proveedor no configurado",
    en: "Provider not configured",
  },
  metaChannelNotConnectable: {
    es: "Ese canal no se conecta por esta vía. WhatsApp usa Embedded Signup; los comentarios se activan solos junto a Messenger/Instagram.",
    en: "That channel can't be connected this way. WhatsApp uses Embedded Signup; comments are enabled automatically alongside Messenger/Instagram.",
  },

  // bulk-delete (clear inbox)
  bulkDeleteNoScope: {
    es: "Indica ids o channels para eliminar",
    en: "Provide ids or channels to delete",
  },
} satisfies Namespace;
