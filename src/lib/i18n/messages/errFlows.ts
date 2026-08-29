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

  // ── shared validation / guards ──
  invalidJson: {
    es: "JSON no válido",
    en: "Invalid JSON",
  },
  notFound: {
    es: "No encontrado",
    en: "Not found",
  },
  notWorkspaceMember: {
    es: "No eres miembro de ese espacio de trabajo",
    en: "You are not a member of that workspace",
  },
  noWorkspace: {
    es: "No se encontró un espacio de trabajo para el usuario",
    en: "No workspace found for the user",
  },

  // ── flows/[id]/activate ──
  activateInvalidStatus: {
    es: "El estado debe ser 'draft', 'active' o 'archived'.",
    en: "Status must be one of 'draft', 'active' or 'archived'.",
  },
  activateHasBlockers: {
    es: "No se puede activar el flujo: corrige primero los problemas de abajo.",
    en: "Cannot activate flow: fix the issues below first.",
  },

  // ── flows/[id] (PUT) ──
  flowNameEmpty: {
    es: "El nombre no puede estar vacío.",
    en: "The name cannot be empty.",
  },

  // ── flows (POST) ──
  flowNoWorkspaceAssigned: {
    es: "El usuario no tiene un workspace asignado.",
    en: "The user has no workspace assigned.",
  },
  flowUnknownTemplate: {
    es: "Plantilla desconocida: \"{slug}\"",
    en: "Unknown template: \"{slug}\"",
  },
  flowNameRequired: {
    es: "El nombre es obligatorio.",
    en: "A name is required.",
  },

  // ── flows/[id]/versions (POST) ──
  versionsFlowNotFound: {
    es: "Flujo no encontrado",
    en: "Flow not found",
  },

  // ── automations (engine / list / create) ──
  automationTriggerTypeRequired: {
    es: "Falta el tipo de disparador",
    en: "trigger_type is required",
  },
  automationNameAndTriggerRequired: {
    es: "El nombre y el tipo de disparador son obligatorios.",
    en: "Name and trigger type are required.",
  },
  automationCannotActivateInvalid: {
    es: "No se puede activar la automatización con una configuración no válida.",
    en: "Cannot activate automation with invalid configuration.",
  },
  automationCannotKeepActiveInvalid: {
    es: "No se puede mantener la automatización activa con una configuración no válida.",
    en: "Cannot keep automation active with invalid configuration.",
  },

  // ── automations/install-from-template ──
  automationTemplateIdRequired: {
    es: "Falta el identificador de la plantilla",
    en: "template_id is required",
  },
  automationUnknownTemplate: {
    es: "Plantilla desconocida",
    en: "Unknown template",
  },
} satisfies Namespace;
