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
  unauthorized: { es: "No autorizado", en: "Unauthorized" },
  forbidden: { es: "Acceso denegado", en: "Forbidden" },
  notFound: { es: "No encontrado", en: "Not found" },
  invalidJson: { es: "JSON inválido", en: "Invalid JSON" },
  urlRequired: { es: "La URL es requerida", en: "url is required" },
  workspaceIdRequired: {
    es: "workspace_id es requerido",
    en: "workspace_id is required",
  },
  workspaceIdNameRequired: {
    es: "workspace_id y nombre son requeridos",
    en: "workspace_id and name are required",
  },
  messageRequired: {
    es: "El mensaje es requerido",
    en: "message is required",
  },

  // Mejorar el borrador del composer
  textRequired: {
    es: "Escribe algo primero",
    en: "Write something first",
  },
  textTooLong: {
    es: "El texto es demasiado largo para mejorarlo",
    en: "The text is too long to improve",
  },
  improveFailed: {
    es: "No se pudo mejorar el texto",
    en: "Couldn't improve the text",
  },

  // Generar la respuesta con el agente
  draftNoKey: {
    es: "Falta la clave de IA para generar respuestas",
    en: "Missing the AI key to generate replies",
  },
  draftNoCredit: {
    es: "La clave de IA se quedó sin saldo. Recárgala en Anthropic y vuelve a intentar.",
    en: "The AI key ran out of credit. Top it up in Anthropic and try again.",
  },
  draftNothingToAnswer: {
    es: "Todavía no hay nada que contestar en este chat",
    en: "There's nothing to answer in this chat yet",
  },
  draftFailed: {
    es: "No se pudo generar la respuesta",
    en: "Couldn't generate the reply",
  },
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
  claudeApiError: {
    es: "Error de la API de Claude ({status}): {message}",
    en: "Claude API error ({status}): {message}",
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

  // Approvals (proactive DMs held for review)
  approvalNotPending: {
    es: "Este mensaje ya no está pendiente de aprobación.",
    en: "This message is no longer pending approval.",
  },
  approvalNoDraft: {
    es: "No hay borrador de mensaje para enviar.",
    en: "There's no draft message to send.",
  },
  instagramNotConnected: {
    es: "Instagram no está conectado.",
    en: "Instagram is not connected.",
  },

  // One active assistant per channel
  channelConflict: {
    es: 'El asistente "{agent}" ya está activo en {channels}. Solo puede haber un asistente activo por canal: pausa el otro o ajusta los canales.',
    en: 'The assistant "{agent}" is already active on {channels}. Only one assistant can be active per channel: pause the other one or adjust the channels.',
  },
  channelsRequired: {
    es: "Elige al menos un canal.",
    en: "Choose at least one channel.",
  },
} satisfies Namespace;
