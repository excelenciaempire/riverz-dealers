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
  igCampaignFallback: { es: "Campaña IG", en: "IG campaign" },
} satisfies Namespace;
