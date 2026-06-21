import type { Namespace } from "./types";

/** Instagram Agent: campaign planner, live "thinking" panel, saved campaigns + detail. */
export const igAgent = {
  // Page header
  eyebrow: { es: "Marketing con IA", en: "AI marketing" },
  title: { es: "Agente de Instagram", en: "Instagram Agent" },
  subtitle: {
    es: "Describe un objetivo y el agente diseña una campaña de DMs 1:1 — audiencia, copy y oferta — lista para revisar y lanzar.",
    en: "Describe a goal and the agent designs a 1:1 DM campaign — audience, copy and offer — ready to review and launch.",
  },

  // Goal box
  goalLabel: { es: "¿Cuál es tu objetivo?", en: "What's your goal?" },
  startFromExample: { es: "Empieza con un ejemplo", en: "Start from an example" },
  generateHint: { es: "⌘ Enter para generar", en: "⌘ Enter to generate" },
  poweredByAi: { es: "Diseñado por IA", en: "Designed by AI" },
  goalPlaceholder: {
    es: "Describe lo que quieres lograr. Ej: reactivar a quienes comentaron mi último reel con un 15% de descuento.",
    en: "Describe what you want to achieve. E.g.: re-engage everyone who commented on my last reel with 15% off.",
  },
  example1: {
    es: "Reactiva a quienes comentaron mi último reel con un 15% de descuento.",
    en: "Re-engage everyone who commented on my last reel with 15% off.",
  },
  example2: {
    es: "Convierte en ventas a quienes guardaron mis posts de producto esta semana.",
    en: "Turn the people who saved my product posts this week into sales.",
  },
  example3: {
    es: "Recupera a clientes que no compran hace más de 60 días con una oferta exclusiva.",
    en: "Win back customers who haven't bought in over 60 days with an exclusive offer.",
  },
  reachablePeople: { es: "personas alcanzables", en: "reachable people" },
  catalogConnected: { es: "catálogo conectado", en: "catalog connected" },
  groundedInAudience: {
    es: "Aterrizado en tu audiencia y catálogo reales.",
    en: "Grounded in your real audience and catalog.",
  },
  designing: { es: "Diseñando…", en: "Designing…" },
  generatePlan: { es: "Generar plan", en: "Generate plan" },
  regeneratePlan: { es: "Regenerar plan", en: "Regenerate plan" },

  // Live "agent thinking" panel
  agentWorking: { es: "El agente está trabajando", en: "The agent is working" },
  thinkingUnderstandGoal: {
    es: "Entendiendo tu objetivo…",
    en: "Understanding your goal…",
  },
  thinkingReviewCatalog: {
    es: "Revisando tu catálogo…",
    en: "Reviewing your catalog…",
  },
  thinkingReviewCatalogCount: {
    es: "Revisando tu catálogo ({n} productos)…",
    en: "Reviewing your catalog ({n} products)…",
  },
  thinkingScanAudience: {
    es: "Escaneando tu audiencia de Instagram…",
    en: "Scanning your Instagram audience…",
  },
  thinkingScanAudienceCount: {
    es: "Escaneando tu audiencia de Instagram ({n} personas)…",
    en: "Scanning your Instagram audience ({n} people)…",
  },
  thinkingDetectIntent: {
    es: "Detectando señales de intención…",
    en: "Detecting intent signals…",
  },
  thinkingFilterComments: {
    es: "Filtrando comentarios y respuestas a historias…",
    en: "Filtering comments and story replies…",
  },
  thinkingDraftDm: {
    es: "Redactando el DM 1:1 en tu voz de marca…",
    en: "Drafting the 1:1 DM in your brand voice…",
  },
  thinkingComputeFunnel: {
    es: "Calculando el embudo y la oferta…",
    en: "Computing the funnel and offer…",
  },

  // Proposed campaign header + funnel
  proposedCampaign: { es: "Campaña propuesta", en: "Proposed campaign" },
  engagementLabel: { es: "Engagement:", en: "Engagement:" },
  contactsCount: { es: "{n} contactos", en: "{n} contacts" },
  funnelContacted: { es: "Contactados", en: "Contacted" },
  funnelReplies: { es: "Respuestas", en: "Replies" },
  funnelConversions: { es: "Conversiones", en: "Conversions" },
  funnelEstRevenue: { es: "Ingresos est.", en: "Est. revenue" },
  estimatesDisclaimer: {
    es: "Estimaciones generadas por IA para orientar la campaña, no cifras garantizadas.",
    en: "AI-generated estimates to guide the campaign, not guaranteed figures.",
  },

  // DM preview
  instagramDm: { es: "DM de Instagram", en: "Instagram DM" },
  offerCodeLabel: { es: "Código", en: "Code" },
  dmBaseNote: {
    es: "Este es el DM base. Al enviarse, el agente lo reescribe 1:1 para cada persona en tu voz de marca, respondiendo a su interacción y con su propio código de descuento. Vista previa con “{name}”.",
    en: "This is the base DM. When sent, the agent rewrites it 1:1 for each person in your brand voice, responding to their interaction and with their own discount code. Preview with “{name}”.",
  },
  followUpIfNoReply: {
    es: "Seguimiento si no responden",
    en: "Follow-up if they don't reply",
  },
  highIntentCommentReply: {
    es: "Respuesta a comentarios de alta intención",
    en: "Reply to high-intent comments",
  },
  commentToDmNote: {
    es: "Mueve la conversación del comentario público al DM privado.",
    en: "Moves the conversation from the public comment to a private DM.",
  },

  // Offer / products / next steps
  offer: { es: "Oferta", en: "Offer" },
  productsToFeature: { es: "Productos a destacar", en: "Products to feature" },
  nextSteps: { es: "Próximos pasos", en: "Next steps" },

  // Actions row
  controlHoldout: { es: "Control (holdout)", en: "Control (holdout)" },
  holdoutTitle: {
    es: "% de la audiencia que NO recibe DM, para medir incrementalidad real",
    en: "% of the audience that does NOT receive a DM, to measure real incrementality",
  },
  regenerate: { es: "Regenerar", en: "Regenerate" },
  saveCampaign: { es: "Guardar campaña", en: "Save campaign" },
  activateAgentOnInstagram: {
    es: "Activar agente en Instagram",
    en: "Activate agent on Instagram",
  },

  // Saved campaigns list
  myCampaigns: { es: "Mis campañas", en: "My campaigns" },
  codePrefix: { es: "Código {code}", en: "Code {code}" },
  deleteCampaign: { es: "Eliminar campaña", en: "Delete campaign" },

  // Empty state — how it works
  howItWorks: { es: "¿Cómo funciona?", en: "How does it work?" },
  howStep1Title: { es: "Describe un objetivo", en: "Describe a goal" },
  howStep1Desc: {
    es: "En lenguaje natural, como se lo dirías a un marketer.",
    en: "In plain language, just like you'd tell a marketer.",
  },
  howStep2Title: {
    es: "El agente arma la campaña",
    en: "The agent builds the campaign",
  },
  howStep2Desc: {
    es: "Detecta el engagement, redacta el DM 1:1 y propone la oferta.",
    en: "It detects engagement, drafts the 1:1 DM and proposes the offer.",
  },
  howStep3Title: { es: "Revisa y lanza", en: "Review and launch" },
  howStep3Desc: {
    es: "Ajusta lo que quieras y conviértelo en una campaña real.",
    en: "Tweak whatever you want and turn it into a real campaign.",
  },

  // Status labels
  statusDraft: { es: "Borrador", en: "Draft" },
  statusActive: { es: "Activa", en: "Active" },
  statusPaused: { es: "Pausada", en: "Paused" },
  statusDone: { es: "Finalizada", en: "Finished" },

  // Toasts + errors
  toastCampaignSaved: { es: "Campaña guardada", en: "Campaign saved" },
  errorSaveCampaign: {
    es: "No se pudo guardar la campaña",
    en: "Couldn't save the campaign",
  },
  errorDelete: {
    es: "No se pudo eliminar la campaña",
    en: "Couldn't delete the campaign",
  },
  errorDescribeGoal: {
    es: "Describe un objetivo primero",
    en: "Describe a goal first",
  },
  errorGeneratePlan: {
    es: "No se pudo generar el plan",
    en: "Couldn't generate the plan",
  },
  errorNetwork: { es: "Error de red", en: "Network error" },

  // Campaign detail — header
  backToAgent: { es: "Agente de Instagram", en: "Instagram Agent" },
  instagramCampaign: { es: "Campaña de Instagram", en: "Instagram campaign" },
  campaignNotFound: { es: "Campaña no encontrada.", en: "Campaign not found." },
  errorLoadCampaign: {
    es: "No se pudo cargar la campaña",
    en: "Couldn't load the campaign",
  },
  errorActionFailed: { es: "La acción falló", en: "The action failed" },

  // Campaign detail — lifecycle actions
  launchCampaign: { es: "Lanzar campaña", en: "Launch campaign" },
  resume: { es: "Retomar", en: "Resume" },
  pauseAgent: { es: "Pausar agente", en: "Pause agent" },
  finish: { es: "Finalizar", en: "Finish" },
  resolveAudience: { es: "Resolver audiencia", en: "Resolve audience" },
  toastCampaignLaunched: { es: "Campaña lanzada", en: "Campaign launched" },
  toastCampaignPaused: { es: "Campaña pausada", en: "Campaign paused" },
  toastCampaignFinished: { es: "Campaña finalizada", en: "Campaign finished" },
  toastAudienceResolved: { es: "Audiencia resuelta", en: "Audience resolved" },

  // Campaign detail — real funnel
  realFunnel: { es: "Embudo real", en: "Real funnel" },
  queued: { es: "En cola", en: "Queued" },
  sent: { es: "Enviados", en: "Sent" },
  replies: { es: "Respuestas", en: "Replies" },
  conversions: { es: "Conversiones", en: "Conversions" },
  attributedLastTouch: {
    es: "atribuidos (último toque)",
    en: "attributed (last touch)",
  },

  // Campaign detail — incrementality
  incrementalityVsControl: {
    es: "Incrementalidad (vs. control de {n})",
    en: "Incrementality (vs. control of {n})",
  },
  incrementalRevenueLabel: {
    es: "revenue incremental · {n} ventas netas",
    en: "incremental revenue · {n} net sales",
  },
  upliftPct: { es: "+{n}% uplift", en: "+{n}% uplift" },
  controlExplanation: {
    es: "El control no recibió DM; restamos su compra orgánica para aislar el efecto real del agente.",
    en: "The control group received no DM; we subtract their organic purchases to isolate the agent's real effect.",
  },

  // Campaign detail — revenue by post
  revenueByPost: { es: "Ingresos por post", en: "Revenue by post" },
  revenueByPostNote: {
    es: "Qué publicación está generando ventas — atribuido al post donde la persona interactuó antes del DM.",
    en: "Which post is driving sales — attributed to the post where the person engaged before the DM.",
  },
  postLabel: { es: "Post …{id}", en: "Post …{id}" },
  salesCountOne: { es: "{n} venta", en: "{n} sale" },
  salesCountOther: { es: "{n} ventas", en: "{n} sales" },

  // Campaign detail — plan
  followUp: { es: "Seguimiento", en: "Follow-up" },
  audience: { es: "Audiencia", en: "Audience" },
} satisfies Namespace;
