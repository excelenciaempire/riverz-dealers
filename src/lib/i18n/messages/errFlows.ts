import type { Namespace } from "./types";

/**
 * Merchant-facing API error/success strings for the flow editor (AI assist,
 * version history, restore) and the broadcast audience preview / test send.
 * These are returned as JSON `{ error: "..." }` (or `{ sent, error }`) and
 * surfaced in dashboard toasts, so they must follow the merchant's locale.
 */
export const errFlows = {
  // ── flows/[id]/assist ──
  assistMissingFields: {
    es: "Falta `message` o `flow_snapshot`.",
    en: "Missing `message` or `flow_snapshot`.",
  },
  assistAnthropicNotConfigured: {
    es: "La clave de Anthropic no está configurada en este servidor (ANTHROPIC_API_KEY).",
    en: "The Anthropic key is not configured on this server (ANTHROPIC_API_KEY).",
  },
  assistUnexpectedAiResponse: {
    es: "La IA no devolvió la estructura esperada. Intenta de nuevo con un pedido más concreto.",
    en: "The AI did not return the expected structure. Try again with a more specific request.",
  },
  assistDefaultReply: {
    es: "Listo.",
    en: "Done.",
  },
  assistPatchesWouldBreak: {
    es: "Los cambios propuestos romperían el flujo: {detail}",
    en: "The proposed changes would break the flow: {detail}",
  },

  // ── flows/[id]/versions ──
  versionsMissingKind: {
    es: "Falta kind",
    en: "Missing kind",
  },

  // ── flows/[id]/versions/[versionId]/restore ──
  restoreVersionNotFound: {
    es: "Versión no encontrada",
    en: "Version not found",
  },
  restoreBackupNote: {
    es: "Backup antes de restaurar",
    en: "Backup before restoring",
  },

  // ── broadcasts/audience-preview ──
  audienceMissing: {
    es: "Falta audience",
    en: "Missing audience",
  },

  // ── broadcasts/test ──
  testNoSession: {
    es: "Sin sesión",
    en: "Not signed in",
  },
  testMissingTemplateOrPhone: {
    es: "Falta templateId o phone",
    en: "Missing templateId or phone",
  },
  testInvalidPhone: {
    es: "Número no válido",
    en: "Invalid phone number",
  },
  testTemplateNotFound: {
    es: "No se encontró la plantilla",
    en: "Template not found",
  },
  testWhatsappNotConfigured: {
    es: "WhatsApp no está configurado",
    en: "WhatsApp is not configured",
  },
  testUnknownError: {
    es: "Error desconocido",
    en: "Unknown error",
  },
} satisfies Namespace;
