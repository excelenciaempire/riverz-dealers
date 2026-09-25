import type { Namespace } from "./types";

/**
 * Merchant-facing API error/success strings for the WhatsApp route handlers
 * (broadcast, config, send, templates/create, templates/generate). Returned
 * as JSON { error: "..." } and surfaced to the merchant in a dashboard toast,
 * so they must be localized.
 */
export const errWhatsapp = {
  mediaUnavailable: { es: 'Adjunto no disponible', en: 'Attachment unavailable' },
  // ── Shared ──
  invalidJson: { es: "JSON inválido", en: "Invalid JSON" },
  notAuthenticated: { es: "No autenticado", en: "Not authenticated" },

  // ── Broadcast ──
  tooManyRecipients: {
    es: "Demasiados destinatarios (máx {max}). Dividí la campaña.",
    en: "Too many recipients (max {max}). Split the campaign into smaller batches.",
  },

  // ── Templates: create ──
  templateNameRequired: {
    es: "El nombre de la plantilla es obligatorio.",
    en: "The template name is required.",
  },
  invalidCategory: { es: "Categoría no válida.", en: "Invalid category." },
  whatsappNotConnected: {
    es: "WhatsApp no está conectado. Conecta tu cuenta de WhatsApp Business en Ajustes primero.",
    en: "WhatsApp is not connected. Connect your WhatsApp Business account in Settings first.",
  },
  missingWabaId: {
    es: "Falta el ID de la Cuenta de WhatsApp Business (WABA). Vuelve a conectar tu cuenta en Ajustes.",
    en: "The WhatsApp Business Account (WABA) ID is missing. Reconnect your account in Settings.",
  },
  // ── Templates: delete ──
  templateNotFound: {
    es: "Esa plantilla ya no está en esta cuenta.",
    en: "That template is no longer in this account.",
  },
  templateDeleteFailed: {
    es: "No se pudo eliminar la plantilla.",
    en: "The template could not be deleted.",
  },

  workspaceResolveFailed: {
    es: "No se pudo resolver el workspace de tu cuenta.",
    en: "Could not resolve your account's workspace.",
  },
  metaRejectedTemplate: {
    es: "Meta rechazó la plantilla.",
    en: "Meta rejected the template.",
  },
  templateSentButMirrorFailed: {
    es: "La plantilla se envió a Meta pero no se pudo guardar localmente: {detail}",
    en: "The template was sent to Meta but could not be saved locally: {detail}",
  },
  createTemplateFailed: {
    es: "No se pudo crear la plantilla",
    en: "Could not create the template",
  },

  // ── Templates: generate (AI) ──
  aiNotConfigured: {
    es: "La generación con IA no está configurada (falta ANTHROPIC_API_KEY).",
    en: "AI generation is not configured (ANTHROPIC_API_KEY is missing).",
  },
  describeMessage: {
    es: "Describe brevemente el mensaje que quieres generar.",
    en: "Briefly describe the message you want to generate.",
  },
  aiReturnedNoText: {
    es: "La IA no devolvió ningún texto. Inténtalo de nuevo.",
    en: "The AI returned no text. Please try again.",
  },
  claudeApiError: {
    es: "Error de la API de Claude ({status}): {message}",
    en: "Claude API error ({status}): {message}",
  },
  generateMessageFailed: {
    es: "No se pudo generar el mensaje",
    en: "Could not generate the message",
  },

  // ── Broadcast ──
  provideRecipientsOrPhones: {
    es: "Indica `recipients` (preferido) o `phone_numbers`, debe ser un arreglo no vacío.",
    en: "Provide either `recipients` (preferred) or `phone_numbers`, must be a non-empty array.",
  },
  templateNameFieldRequired: {
    es: "El nombre de la plantilla (template_name) es obligatorio.",
    en: "template_name is required.",
  },
  whatsappNotConfiguredSetup: {
    es: "WhatsApp no está configurado. Configura tu integración de WhatsApp primero.",
    en: "WhatsApp is not configured. Please set up your WhatsApp integration first.",
  },
  broadcastFailed: {
    es: "No se pudo procesar la campaña.",
    en: "Could not process the broadcast.",
  },

  // ── Send ──
  conversationAndTypeRequired: {
    es: "conversation_id y message_type son obligatorios.",
    en: "conversation_id and message_type are required.",
  },
  contentTextRequired: {
    es: "content_text es obligatorio para mensajes de texto.",
    en: "content_text is required for text messages.",
  },
  templateNameRequiredForTemplate: {
    es: "template_name es obligatorio para mensajes con plantilla.",
    en: "template_name is required for template messages.",
  },
  conversationNotFound: {
    es: "Conversación no encontrada.",
    en: "Conversation not found.",
  },
  contactPhoneNotFound: {
    es: "No se encontró el número de teléfono del contacto.",
    en: "Contact phone number not found.",
  },
  invalidPhoneFormat: {
    es: "Formato de número de teléfono no válido.",
    en: "Invalid phone number format.",
  },
  noWhatsappConnection: {
    es: "Primero conecta un número de WhatsApp en Integraciones.",
    en: "Connect a WhatsApp number in Integrations first.",
  },
  windowClosedNeedsTemplate: {
    es: "La ventana de 24 horas está cerrada. Para este número debes usar una plantilla aprobada.",
    en: "The 24 hour window is closed. Use an approved template for this number.",
  },
  replyTargetNotFound: {
    es: "El mensaje al que respondes no existe en esta conversación.",
    en: "reply_to_message_id not found in this conversation.",
  },
  messageSentButSaveFailed: {
    es: "El mensaje se envió a Meta pero no se pudo guardar en la base de datos: {detail}",
    en: "Message sent to Meta but failed to save to DB: {detail}",
  },
  sendMessageFailed: {
    es: "No se pudo enviar el mensaje.",
    en: "Could not send the message.",
  },

  // ── Config ──
  accessTokenAndPhoneRequired: {
    es: "access_token y phone_number_id son obligatorios.",
    en: "access_token and phone_number_id are required.",
  },
  encryptTokenFailed: {
    es: "No se pudo cifrar el token. Verifica que ENCRYPTION_KEY sea una cadena hexadecimal válida de 64 caracteres en tus variables de entorno.",
    en: "Failed to encrypt token. Check that ENCRYPTION_KEY is a valid 64-character hex string in your environment variables.",
  },
  updateConfigFailed: {
    es: "No se pudo actualizar la configuración.",
    en: "Failed to update configuration.",
  },
  saveConfigFailed: {
    es: "No se pudo guardar la configuración.",
    en: "Failed to save configuration.",
  },
  deleteConfigFailed: {
    es: "No se pudo eliminar la configuración.",
    en: "Failed to delete configuration.",
  },
  internalServerError: {
    es: "Error interno del servidor.",
    en: "Internal server error.",
  },
  fetchConfigFailed: {
    es: "No se pudo obtener la configuración.",
    en: "Failed to fetch configuration.",
  },
  noConfigSavedYet: {
    es: "Aún no hay configuración de WhatsApp guardada. Completa el formulario y haz clic en Guardar configuración.",
    en: "No WhatsApp configuration saved yet. Fill in the form and click Save Configuration.",
  },
  tokenCorrupted: {
    es: 'El token de acceso guardado no se puede descifrar con la ENCRYPTION_KEY actual. Suele significar que la clave cambió o que difiere entre entornos (local vs producción). Haz clic en "Restablecer configuración" abajo y vuelve a guardar.',
    en: 'The stored access token cannot be decrypted with the current ENCRYPTION_KEY. This usually means the key changed, or it differs between environments (local vs production). Click "Reset Configuration" below, then re-save.',
  },

  // ── React (reactions) ──
  messageIdAndEmojiRequired: {
    es: "message_id y emoji son obligatorios.",
    en: "message_id and emoji are required.",
  },
  messageNotFound: {
    es: "Mensaje no encontrado.",
    en: "Message not found.",
  },
  cannotReactUnsentMessage: {
    es: "No se puede reaccionar a un mensaje que aún no se ha enviado a WhatsApp.",
    en: "Cannot react to a message that has not been sent to WhatsApp.",
  },
  reactionSavedDeleteFailed: {
    es: "La reacción se envió a Meta pero no se pudo eliminar localmente.",
    en: "Reaction sent to Meta but DB delete failed.",
  },
  reactionSavedUpsertFailed: {
    es: "La reacción se envió a Meta pero no se pudo guardar localmente.",
    en: "Reaction sent to Meta but DB upsert failed.",
  },
  reactToMessageFailed: {
    es: "No se pudo reaccionar al mensaje.",
    en: "Could not react to the message.",
  },

  // ── Media ──
  mediaIdRequired: {
    es: "El ID del archivo multimedia es obligatorio.",
    en: "Media ID is required.",
  },
  whatsappNotConfigured: {
    es: "WhatsApp no está configurado.",
    en: "WhatsApp is not configured.",
  },
  fetchMediaFailed: {
    es: "No se pudo obtener el archivo multimedia.",
    en: "Could not fetch the media.",
  },

  // ── Templates: sync ──
  whatsappNotConnectedSync: {
    es: "WhatsApp no está conectado. Conecta tu cuenta de WhatsApp Business en Ajustes primero.",
    en: "WhatsApp is not connected. Connect your WhatsApp Business account in Settings first.",
  },
  missingWabaIdSync: {
    es: "Falta el ID de la Cuenta de WhatsApp Business (WABA). Vuelve a conectar tu cuenta en Ajustes.",
    en: "WABA (WhatsApp Business Account) ID missing. Re-connect your account in Settings.",
  },
  noWorkspaceResolved: {
    es: "No se pudo resolver el workspace de esta cuenta.",
    en: "No workspace resolved for this account.",
  },
  syncTemplatesFailed: {
    es: "No se pudieron sincronizar las plantillas.",
    en: "Could not sync templates.",
  },
} satisfies Namespace;
