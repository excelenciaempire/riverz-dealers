import type { Namespace } from "./types";

/** Instagram Agent: stats strip, campaign planner, plan panel, saved campaigns + detail. */
export const igAgent = {
  // Page header
  title: { es: "Prospección IA", en: "AI Prospecting" },
  settingsMenu: { es: "Ajustes del agente", en: "Agent settings" },

  // Goal box
  goalLabel: { es: "¿Cuál es tu objetivo?", en: "What's your goal?" },
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
  example4: {
    es: "Convierte a quienes comentan en suscriptores de tu lista con un imán de leads.",
    en: "Turn commenters into email/SMS subscribers with a lead magnet.",
  },
  // Etiquetas cortas de los chips: la frase larga es la que se escribe al pulsar.
  exampleShort1: { es: "Reactivar comentarios", en: "Re-engage commenters" },
  exampleShort2: { es: "Convertir guardados", en: "Convert saves" },
  exampleShort3: { es: "Recuperar clientes", en: "Win back customers" },
  exampleShort4: { es: "Captar suscriptores", en: "Capture subscribers" },

  // Stats strip
  statRevenue: { es: "Ingresos atribuidos", en: "Attributed revenue" },
  statReplyRate: { es: "{n}% de respuesta", en: "{n}% reply rate" },

  limitsSection: { es: "Límites", en: "Limits" },
  outreachEnabled: {
    es: "Iniciar conversaciones automáticamente",
    en: "Start conversations automatically",
  },
  outreachEnabledHint: {
    es: "El agente escribe él mismo a quien encaja en tus campañas activas.",
    en: "The agent messages whoever fits your live campaigns, on its own.",
  },

  marketingOptin: {
    es: "Pedir permiso para escribir después",
    en: "Ask permission to write later",
  },
  marketingOptinHint: {
    es: "Mientras conversa, ofrece recibir novedades. Quien acepta queda contactable siempre, no solo 24 horas.",
    en: "While chatting, it offers to send updates. Whoever accepts stays reachable for good, not just 24 hours.",
  },

  reachableNow: { es: "contactables ahora", en: "reachable now" },
  reachHint: {
    es: "{subs} suscriptores (sin vencimiento), {dm} con DM abierto (24h) y {comments} que comentaron en los últimos 7 días. Histórico de Instagram: {total}.",
    en: "{subs} subscribers (no expiry), {dm} with an open DM (24h) and {comments} who commented in the last 7 days. Instagram history: {total}.",
  },
  subscribersSub: {
    es: "{n} suscriptores fijos",
    en: "{n} standing subscribers",
  },
  igConnected: { es: "Instagram conectado", en: "Instagram connected" },
  igNotConnected: { es: "Instagram sin conectar", en: "Instagram not connected" },
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
    es: "Redactando el DM en tu voz de marca…",
    en: "Drafting the DM in your brand voice…",
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
  followUpIfNoReply: {
    es: "Seguimiento si no responden",
    en: "Follow-up if they don't reply",
  },
  highIntentCommentReply: {
    es: "Respuesta a comentarios de alta intención",
    en: "Reply to high-intent comments",
  },

  // Offer / products
  offer: { es: "Oferta", en: "Offer" },
  productsToFeature: { es: "Productos a destacar", en: "Products to feature" },

  // Actions row
  saveDraft: { es: "Guardar borrador", en: "Save draft" },
  saveAndLaunch: { es: "Guardar y lanzar", en: "Save and launch" },
  cancel: { es: "Cancelar", en: "Cancel" },
  confirmDelete: { es: "Eliminar", en: "Delete" },

  // Saved campaigns list
  myCampaigns: { es: "Mis campañas", en: "My campaigns" },
  codePrefix: { es: "Código {code}", en: "Code {code}" },
  deleteCampaign: { es: "Eliminar campaña", en: "Delete campaign" },
  noCampaignsYet: {
    es: "Aún no hay campañas. Describe un objetivo y el agente arma la primera.",
    en: "No campaigns yet. Describe a goal and the agent will build the first one.",
  },

  // Proactive controls (kill-switch + daily cap)
  controlsPause: { es: "Pausar todo", en: "Pause all" },
  controlsPausedOn: { es: "Proactivo en pausa", en: "Proactive paused" },
  controlsPauseHint: {
    es: "Detiene al instante todos los DMs proactivos de Instagram.",
    en: "Instantly stops every proactive Instagram DM.",
  },
  controlsDailyCap: { es: "Tope diario", en: "Daily cap" },
  controlsDailyCapHint: {
    es: "Máximo de DMs proactivos por día.",
    en: "Max proactive DMs per day.",
  },

  // Estadísticas propias de Comentarios: las dos cosas que pasaron, sin
  // repartirlas por quién las hizo.
  // Las dos cifras usan las MISMAS palabras que la pregunta "Dónde contesta":
  // "Comentarios respondidos" daba 0 en el modo por defecto (solo privado),
  // aunque cada DM fuera un comentario respondido.
  statCommentsAnswered: {
    es: "En el comentario",
    en: "On the comment",
  },
  statDmsSent: { es: "Por privado", en: "By DM" },
  statLastDays: { es: "Últimos {n} días", en: "Last {n} days" },
  researchedSub: { es: "{n} con perfil investigado", en: "{n} profiles researched" },

  // Página Comentarios
  commentsSubtitle: {
    es: "Qué pasa cuando alguien comenta en tus posts.",
    en: "What happens when someone comments on your posts.",
  },
  autoReplyComments: {
    es: "Responder con IA",
    en: "Reply with AI",
  },
  // A quién contesta y cuánto insiste (migración 132)
  audienceIntent: {
    es: "Solo a quien quiere comprar",
    en: "Only people who want to buy",
  },
  // Sin glosa: vive debajo de "Responder con IA", que ya está encendido, así
  // que apagar un filtro sólo puede significar quitar el filtro.
  audienceIntentHint: { es: "", en: "" },
  // Dónde contesta la IA un comentario (migración 177)
  replyModeLabel: { es: "Dónde contesta", en: "Where it replies" },
  replyMode_dm: { es: "Solo por privado", en: "Private message only" },
  replyModeHint_dm: { es: "", en: "" },
  replyMode_public_dm: {
    es: "En el comentario y por privado",
    en: "On the comment and by DM",
  },
  replyModeHint_public_dm: {
    es: "Una línea en el post; la respuesta completa en el DM.",
    en: "A line on the post; the full answer in the DM.",
  },
  replyMode_public_smart: {
    es: "En el comentario, y por privado si hace falta",
    en: "On the comment, and by DM when needed",
  },
  replyModeHint_public_smart: {
    es: "Guarda el privado para lo que no va bajo la foto: precios, pedidos, reclamos.",
    en: "Saves the DM for what doesn't belong under a photo: prices, orders, complaints.",
  },
  replyMode_public: { es: "Solo en el comentario", en: "On the comment only" },
  replyModeHint_public: { es: "", en: "" },
  networksLabel: { es: "En qué redes", en: "Which networks" },
  network_instagram: { es: "Instagram", en: "Instagram" },
  network_facebook: { es: "Facebook", en: "Facebook" },
  network_tiktok: { es: "TikTok", en: "TikTok" },
  // TikTok no tiene privado: su API de mensajes está cerrada a terceros. Sin
  // este aviso, elegir "Solo por privado" con TikTok encendido sorprende con
  // respuestas públicas bajo el video.
  tiktokPublicOnly: {
    es: "En TikTok siempre contesta en el comentario: no tiene privado.",
    en: "On TikTok it always replies on the comment: there are no DMs.",
  },
  backfillTitle: { es: "Importar historial", en: "Import history" },
  backfillDays: { es: "Periodo", en: "Period" },
  backfillDays7: { es: "7 días", en: "7 days" },
  backfillDays30: { es: "30 días", en: "30 days" },
  backfillDays90: { es: "90 días", en: "90 days" },
  backfillDays3650: { es: "Todo el historial", en: "All history" },
  backfillContent: { es: "Importar", en: "Import" },
  backfillComments: { es: "Comentarios", en: "Comments" },
  backfillMessages: { es: "Mensajes", en: "Messages" },
  backfillChannels: { es: "Canales", en: "Channels" },
  backfillRun: { es: "Importar comentarios", en: "Import comments" },
  backfillRunning: { es: "Importando…", en: "Importing…" },
  backfillDone: {
    es: "{n} comentarios importados. No se envió ninguna respuesta.",
    en: "{n} comments imported. No reply was sent.",
  },
  backfillFailed: { es: "No se pudo importar el historial", en: "Couldn't import history" },

  // Order attribution ledger
  attributedOrdersTitle: {
    es: "Pedidos atribuidos",
    en: "Attributed orders",
  },
  orderLabelName: { es: "Pedido {name}", en: "Order {name}" },
  orderSourceCampaign: { es: "campaña", en: "campaign" },
  orderSourceAgent: { es: "agente", en: "agent" },
  orderSourceCommentToDm: { es: "comentario→DM", en: "comment→DM" },
  orderSourceCtwa: { es: "anuncio", en: "ad" },

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
  backToAgent: { es: "Prospección IA", en: "AI Prospecting" },
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
  live: { es: "En vivo", en: "Live" },
  queuedInline: { es: "{n} en cola", en: "{n} queued" },
  queued: { es: "En cola", en: "Queued" },
  breakdownPending: { es: "pendientes", en: "pending" },
  breakdownSkipped: { es: "omitidos", en: "skipped" },
  breakdownFailed: { es: "fallidos", en: "failed" },
  breakdownSkippedNote: {
    es: "Omitidos = sin ventana de Meta abierta, spam o baja voluntaria.",
    en: "Skipped = no open Meta window, spam, or opted out.",
  },
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
    es: "Qué publicación está generando ventas, atribuido al post donde la persona interactuó antes del DM.",
    en: "Which post is driving sales, attributed to the post where the person engaged before the DM.",
  },
  postLabel: { es: "Post …{id}", en: "Post …{id}" },
  salesCountOne: { es: "{n} venta", en: "{n} sale" },
  salesCountOther: { es: "{n} ventas", en: "{n} sales" },

  // Campaign detail — plan
  followUp: { es: "Seguimiento", en: "Follow-up" },
  audience: { es: "Audiencia", en: "Audience" },
} satisfies Namespace;
