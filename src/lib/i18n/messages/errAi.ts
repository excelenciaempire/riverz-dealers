import type { Namespace } from "./types";

/**
 * Merchant-facing API error/success messages for the AI agent routes
 * (knowledge sync, agent test, generate-from-url, and the Instagram
 * campaign endpoints). These strings are returned as `{ error }` / `{ message }`
 * JSON and surfaced to the merchant in dashboard toasts.
 */
export const errAi = {
  // Shared validation / auth
  notAuthenticated: { es: "No autenticado", en: "Not authenticated" },
  urlInvalidHttps: {
    es: "URL inválida. Debe empezar con https://",
    en: "Invalid URL. It must start with https://",
  },

  // Firecrawl / knowledge sync
  firecrawlMissingKey: {
    es: "Falta FIRECRAWL_API_KEY en el servidor.",
    en: "FIRECRAWL_API_KEY is missing on the server.",
  },
  firecrawlRejected: {
    es: "Firecrawl no aceptó el crawl (status {status})",
    en: "Firecrawl rejected the crawl (status {status})",
  },
  firecrawlRejectedAlt: {
    es: "Firecrawl rechazó el crawl (status {status})",
    en: "Firecrawl rejected the crawl (status {status})",
  },
  firecrawlFailed: {
    es: "Firecrawl falló durante el crawl.",
    en: "Firecrawl failed during the crawl.",
  },
  firecrawlUnreachable: {
    es: "No se pudo contactar Firecrawl",
    en: "Could not reach Firecrawl",
  },

  // Agent test
  missingApiKey: {
    es: "Falta la API key (workspace o ANTHROPIC_API_KEY del servidor).",
    en: "API key is missing (workspace key or the server's ANTHROPIC_API_KEY).",
  },
  testGenerateFailed: {
    es: "No se pudo generar la respuesta",
    en: "Could not generate the reply",
  },

  // Generate from URL
  urlWorkspaceRequired: {
    es: "url y workspace_id son requeridos",
    en: "url and workspace_id are required",
  },
  scrapeFailed: {
    es: "No se pudo scrapear la web.",
    en: "Could not scrape the website.",
  },
  agentCreateFailed: {
    es: "No se pudo crear el agente",
    en: "Could not create the agent",
  },

  // Instagram agent (plan generation)
  agentNotConfigured: {
    es: "El Agente de Ventas no está configurado (falta ANTHROPIC_API_KEY).",
    en: "The Sales Agent is not configured (ANTHROPIC_API_KEY is missing).",
  },
  describeGoal: {
    es: "Describe el objetivo de tu campaña.",
    en: "Describe the goal of your campaign.",
  },
  goalTooLong: {
    es: "El objetivo es demasiado largo (máx. 2000 caracteres).",
    en: "The goal is too long (max. 2000 characters).",
  },
  noPlanReturned: {
    es: "El Agente no devolvió ningún plan. Inténtalo de nuevo.",
    en: "The Agent did not return a plan. Please try again.",
  },
  planParseFailed: {
    es: "No se pudo interpretar el plan generado. Inténtalo de nuevo.",
    en: "Could not parse the generated plan. Please try again.",
  },
  generatePlanFailed: {
    es: "No se pudo generar el plan",
    en: "Could not generate the plan",
  },

  // Campaigns (create / list)
  noWorkspace: {
    es: "No perteneces a ningún workspace.",
    en: "You don't belong to any workspace.",
  },
  missingGoalOrPlan: {
    es: "Faltan el objetivo o un plan válido.",
    en: "The goal or a valid plan is missing.",
  },

  // Campaigns (detail / patch / delete)
  campaignNotFound: { es: "No encontrada", en: "Not found" },
  invalidStatus: { es: "Estado inválido", en: "Invalid status" },
  invalidPlan: { es: "Plan inválido", en: "Invalid plan" },
  nothingToUpdate: { es: "Nada que actualizar", en: "Nothing to update" },

  // Campaigns (launch / resolve)
  campaignAlreadyDone: {
    es: "La campaña ya está finalizada.",
    en: "The campaign is already finished.",
  },
  campaignNoValidPlan: {
    es: "La campaña no tiene un plan válido.",
    en: "The campaign doesn't have a valid plan.",
  },
  resolveAudienceFailed: {
    es: "No se pudo resolver la audiencia",
    en: "Could not resolve the audience",
  },
  noInstagramContactsLaunch: {
    es: "No hay contactos de Instagram para esta campaña todavía. Conecta Instagram y deja que lleguen interacciones.",
    en: "There are no Instagram contacts for this campaign yet. Connect Instagram and let interactions come in.",
  },
  noInstagramContactsResolve: {
    es: "No hay contactos de Instagram todavía. Conecta Instagram y deja que lleguen interacciones primero.",
    en: "There are no Instagram contacts yet. Connect Instagram and let interactions come in first.",
  },
} satisfies Namespace;
