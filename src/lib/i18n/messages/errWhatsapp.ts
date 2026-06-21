import type { Namespace } from "./types";

/**
 * Merchant-facing API error/success strings for the WhatsApp route handlers
 * (broadcast, config, send, templates/create, templates/generate). Returned
 * as JSON { error: "..." } and surfaced to the merchant in a dashboard toast,
 * so they must be localized.
 */
export const errWhatsapp = {
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
} satisfies Namespace;
