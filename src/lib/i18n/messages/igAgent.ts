import type { Namespace } from "./types";

/** Instagram Agent: campaign planner, live "thinking" panel, saved campaigns + detail. */
export const igAgent = {
  // Page header
  eyebrow: { es: "Marketing con IA", en: "AI marketing" },
  title: { es: "Ventas por Instagram", en: "Instagram Sales" },
  subtitle: {
    es: "Describe un objetivo y tu agente sale a buscar a quién venderle: audiencia, mensaje y oferta, listos para revisar y lanzar.",
    en: "Describe a goal and your agent goes out to find who to sell to: audience, message and offer, ready to review and launch.",
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
  example4: {
    es: "Convierte a quienes comentan en suscriptores de tu lista con un imán de leads.",
    en: "Turn commenters into email/SMS subscribers with a lead magnet.",
  },
  reachablePeople: {
    es: "alcanzables por Instagram",
    en: "reachable on Instagram",
  },
  newCampaign: { es: "Nueva campaña", en: "New campaign" },

  // Los tres bloques del hub
  blockDmTitle: { es: "Responde los DMs", en: "Answers your DMs" },
  blockDmHint: {
    es: "Cuando alguien te escribe por privado, contesta tu agente de IA con tu catálogo y tus reglas.",
    en: "When someone DMs you, your AI agent answers with your catalog and your rules.",
  },
  blockCommentsTitle: {
    es: "Responde los comentarios",
    en: "Answers your comments",
  },
  blockCommentsHint: {
    es: "Qué pasa cuando alguien comenta en tus posts: a quién se le escribe por privado y con qué reglas.",
    en: "What happens when someone comments on your posts: who gets a private reply and under which rules.",
  },
  blockOutreachTitle: {
    es: "Inicia conversaciones",
    en: "Starts conversations",
  },
  blockOutreachHint: {
    es: "Sal a buscar tú: describe un objetivo y el agente elige a quién escribirle primero y con qué.",
    en: "Go find them: describe a goal and the agent picks who to message first, and with what.",
  },
  limitsSection: { es: "Límites", en: "Limits" },

  // Bloque 1 — agente de DMs
  dmAgentActive: {
    es: "Atiende tus DMs de Instagram",
    en: "Handling your Instagram DMs",
  },
  dmAgentNone: { es: "Sin agente configurado", en: "No agent configured" },
  dmAgentNoneHint: {
    es: "Nadie contesta tus DMs automáticamente. Los comentarios sí siguen funcionando.",
    en: "Nobody answers your DMs automatically. Comments still work.",
  },
  dmAgentConfigure: { es: "Configurar", en: "Configure" },
  dmAgentCreate: { es: "Crear agente", en: "Create agent" },
  reachableNow: { es: "contactables ahora", en: "reachable now" },
  reachHint: {
    es: "{dm} con DM abierto (24h) y {comments} que comentaron en los últimos 7 días. Fuera de esas ventanas Meta no permite escribir. Histórico de Instagram: {total}.",
    en: "{dm} with an open DM (24h) and {comments} who commented in the last 7 days. Outside those windows Meta doesn't allow messaging. Instagram history: {total}.",
  },
  igConnected: { es: "Instagram conectado", en: "Instagram connected" },
  igNotConnected: { es: "Instagram sin conectar", en: "Instagram not connected" },
  inWindowInline: { es: "{n} en ventana", en: "{n} in window" },
  inWindowHint: {
    es: "Dentro de la ventana de 24h de Meta ahora mismo: {n}. Solo estas personas pueden recibir un DM libre ya; el resto, cuando vuelvan a interactuar.",
    en: "Inside Meta's 24h window right now: {n}. Only these can receive a free-form DM immediately; the rest, when they interact again.",
  },
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
  dmBaseNote: {
    es: "Este es el DM base. Al enviarse, el agente lo reescribe para cada persona en tu voz de marca, respondiendo a su interacción y con su propio código de descuento. Vista previa con “{name}”.",
    en: "This is the base DM. When sent, the agent rewrites it for each person in your brand voice, responding to their interaction and with their own discount code. Preview with “{name}”.",
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
  holdoutLabel: { es: "Grupo de control", en: "Control group" },
  voiceLabel: { es: "Voz", en: "Voice" },
  voiceHint: {
    es: "El agente cuya voz y conocimiento escriben los DMs de esta campaña.",
    en: "The agent whose voice and knowledge write this campaign's DMs.",
  },
  saveDraft: { es: "Guardar borrador", en: "Save draft" },
  saveAndLaunch: { es: "Guardar y lanzar", en: "Save and launch" },
  cancel: { es: "Cancelar", en: "Cancel" },
  confirmDelete: { es: "Eliminar", en: "Delete" },
  automationSection: { es: "Automatización", en: "Automation" },
  holdoutTitle: {
    es: "% de la audiencia que NO recibe DM, para medir incrementalidad real",
    en: "% of the audience that does NOT receive a DM, to measure real incrementality",
  },
  regenerate: { es: "Regenerar", en: "Regenerate" },
  saveCampaign: { es: "Guardar campaña", en: "Save campaign" },
  activateAgentOnInstagram: {
    es: "Activar respuestas con el Asistente",
    en: "Enable replies with the Assistant",
  },

  // Saved campaigns list
  myCampaigns: { es: "Mis campañas", en: "My campaigns" },
  codePrefix: { es: "Código {code}", en: "Code {code}" },
  deleteCampaign: { es: "Eliminar campaña", en: "Delete campaign" },

  // Approvals queue (proactive DMs held for review)
  approvalsTitle: { es: "Pendientes de aprobación", en: "Pending approval" },
  approvalsHint: {
    es: "DMs que el agente preparó y esperan tu visto bueno antes de enviarse.",
    en: "DMs the agent drafted, waiting for your go-ahead before sending.",
  },
  approvalTo: { es: "Para {name}", en: "To {name}" },
  approvalUnknownContact: {
    es: "Contacto de Instagram",
    en: "Instagram contact",
  },
  approvalApprove: { es: "Aprobar y enviar", en: "Approve & send" },
  approvalReject: { es: "Descartar", en: "Discard" },
  approvalDismiss: { es: "Quitar", en: "Remove" },
  approvalSent: { es: "DM enviado", en: "DM sent" },
  approvalExpired: {
    es: "La ventana de Meta se cerró: este DM ya no puede enviarse.",
    en: "Meta's window closed: this DM can no longer be sent.",
  },
  approvalWindowClosed: {
    es: "No se envió: la ventana de Meta ya se cerró.",
    en: "Not sent: Meta's window has already closed.",
  },
  approvalError: {
    es: "No se pudo procesar la aprobación",
    en: "Could not process the approval",
  },

  // Proactive controls (kill-switch + daily cap)
  controlsPause: { es: "Pausar todo", en: "Pause all" },
  controlsPausedOn: { es: "Proactivo en pausa", en: "Proactive paused" },
  controlsPauseHint: {
    es: "Detiene al instante TODOS los DMs proactivos de Instagram (interruptor de emergencia).",
    en: "Instantly stops ALL proactive Instagram DMs (emergency switch).",
  },
  controlsDailyCap: { es: "Tope diario", en: "Daily cap" },
  controlsDailyCapHint: {
    es: "Máximo de DMs proactivos por día (protege tu reputación de envío).",
    en: "Max proactive DMs per day (protects your sending reputation).",
  },

  // Proactive automation mode (auto ↔ approval), surfaced in the hub controls
  modeLabel: { es: "Modo", en: "Mode" },
  modeAuto: { es: "Auto", en: "Auto" },
  modeHybrid: { es: "Híbrido", en: "Hybrid" },
  modeApproval: { es: "Aprobación", en: "Approval" },
  autoReplyComments: {
    es: "Contestar siempre a quien pregunta",
    en: "Always answer people who ask",
  },
  autoReplyCommentsHint: {
    es: "Aunque no haya campaña activa, el agente responde por privado a los comentarios con intención de compra. El comentario casual y el spam no reciben nada.",
    en: "Even with no active campaign, the agent privately answers comments that show buying intent. Casual comments and spam get nothing.",
  },
  modeAutoDesc: {
    es: "El agente envía solo, dentro de tus límites.",
    en: "The agent sends on its own, within your limits.",
  },
  modeHybridDesc: {
    es: "Envía solo a quien muestra intención clara; el resto espera tu visto bueno.",
    en: "Sends only to clear high-intent leads; the rest waits for your go-ahead.",
  },
  modeApprovalDesc: {
    es: "Cada DM espera tu aprobación.",
    en: "Every DM waits for your approval.",
  },

  // Order attribution ledger
  attributedOrdersTitle: {
    es: "Pedidos atribuidos a Instagram",
    en: "Orders attributed to Instagram",
  },
  attributedOrdersHint: {
    es: "Ventas que ocurrieron gracias al agente — campaña, DM, comentario→DM o anuncio.",
    en: "Sales that happened thanks to the agent — campaign, DM, comment→DM or ad.",
  },
  attributedOrdersTotal: { es: "Total atribuido", en: "Attributed total" },
  orderLabelName: { es: "Pedido {name}", en: "Order {name}" },
  orderSourceCampaign: { es: "campaña", en: "campaign" },
  orderSourceAgent: { es: "agente", en: "agent" },
  orderSourceCommentToDm: { es: "comentario→DM", en: "comment→DM" },
  orderSourceCtwa: { es: "anuncio", en: "ad" },

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
  backToAgent: { es: "Ventas por Instagram", en: "Instagram Sales" },
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
  breakdownPending: { es: "en aprobación", en: "awaiting approval" },
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
