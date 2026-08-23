import type { Namespace } from "./types";

/** Panel de plataforma (riverz.co/admin) — solo equipo Riverz. */
export const admin = {
  title: { es: "Admin", en: "Admin" },
  subtitle: { es: "Ajustes globales de la plataforma", en: "Platform-wide settings" },
  backToApp: { es: "Volver a la app", en: "Back to app" },
  // Grupos del índice
  groupWorkspaces: { es: "Comercios", en: "Merchants" },
  groupObservability: { es: "Qué está pasando", en: "What's happening" },
  groupConfig: { es: "Configuración", en: "Configuration" },
  // Secciones
  sectionWorkspaces: { es: "Comercios", en: "Merchants" },
  sectionWorkspacesDesc: {
    es: "Todas las cuentas: dueño, equipo, canales y actividad.",
    en: "Every account: owner, team, channels and activity.",
  },
  sectionUsers: { es: "Usuarios", en: "Users" },
  sectionUsersDesc: {
    es: "Personas registradas y los comercios a los que pertenecen.",
    en: "Registered people and the merchants they belong to.",
  },
  sectionUsage: { es: "Uso y costos", en: "Usage & cost" },
  sectionUsageDesc: {
    es: "Mensajes, tokens de IA, minutos de voz y su costo por comercio.",
    en: "Messages, AI tokens, voice minutes and their cost per merchant.",
  },
  sectionWaitlist: { es: "Lista de espera", en: "Waitlist" },
  sectionWaitlistDesc: {
    es: "Interesados que dejaron su correo antes del lanzamiento.",
    en: "People who left their email before launch.",
  },
  sectionLogs: { es: "Registros", en: "Logs" },
  sectionLogsDesc: {
    es: "Por qué la IA no respondió, qué envío falló y qué webhook quedó trabado.",
    en: "Why the AI didn't reply, which send failed, which webhook got stuck.",
  },
  sectionChannels: { es: "Canales", en: "Channels" },
  sectionChannelsDesc: {
    es: "Estado de cada conexión de la plataforma y su último error.",
    en: "Status of every connection on the platform and its last error.",
  },

  // Recursos que el equipo entrega a un comercio
  resourcesTitle: { es: "Recursos", en: "Resources" },
  wooPluginDesc: {
    es: "Plugin de WordPress para recuperar carritos abandonados en WooCommerce. La tienda ya recupera los pedidos que quedaron sin pagar; el plugin agrega a quien se va antes de enviar el pedido.",
    en: "WordPress plugin to recover abandoned carts on WooCommerce. Stores already recover orders left unpaid; the plugin adds those who leave before placing the order.",
  },
  wooPluginDownload: {
    es: "Descargar plugin de WooCommerce",
    en: "Download WooCommerce plugin",
  },
  wooPluginNoSecret: {
    es: "Copia sin credenciales. Cada comercio pega su secreto desde Ajustes → Canales, o baja desde ahí una copia ya configurada.",
    en: "Copy without credentials. Each merchant pastes their secret from Settings → Channels, or downloads a preconfigured copy there.",
  },
  sectionOps: { es: "Operación", en: "Operations" },
  sectionOpsDesc: {
    es: "Trabajos de fondo: cuándo corrió cada uno y cuáles fallaron.",
    en: "Background jobs: when each ran and which ones failed.",
  },
  sectionAudit: { es: "Auditoría", en: "Audit" },
  sectionAuditDesc: {
    es: "Qué miró y qué cambió cada miembro del equipo.",
    en: "What each team member viewed and changed.",
  },
  sectionVoice: { es: "Modelo de voz", en: "Voice model" },
  sectionVoiceDesc: {
    es: "Stack STT · LLM · TTS que usan todas las cuentas.",
    en: "STT · LLM · TTS stack used by every account.",
  },
  // Funcionalidades (feature flags)
  sectionFeatures: { es: "Funcionalidades", en: "Features" },
  sectionFeaturesDesc: {
    es: "Prende o apaga funciones de la app para todas las cuentas.",
    en: "Turn app features on or off for every account.",
  },
  featuresTitle: { es: "Funcionalidades", en: "Features" },
  featuresDesc: {
    es: "Al apagar una, se esconde del menú y su URL queda bloqueada para todos (los admins la siguen viendo).",
    en: "Turning one off hides it from the menu and blocks its URL for everyone (admins still see it).",
  },
  featureFlows: { es: "Flujos", en: "Flows" },
  featureFlowsDesc: {
    es: "Constructor visual de flujos/menús conversacionales.",
    en: "Visual builder for conversational flows/menus.",
  },
  featureVoice: { es: "Voz", en: "Voice" },
  featureVoiceDesc: {
    es: "Llamadas con agentes de IA y campañas de voz.",
    en: "AI agent phone calls and voice campaigns.",
  },
  featureComments: { es: "Comentarios", en: "Comments" },
  featureCommentsDesc: {
    es: "Moderación y respuesta automática de comentarios de Instagram y Facebook.",
    en: "Moderation and auto-reply for Instagram and Facebook comments.",
  },
  featureInstagramAgent: { es: "Ventas por Instagram", en: "Instagram sales" },
  featureInstagramAgentDesc: {
    es: "Campañas proactivas de mensajes directos en Instagram.",
    en: "Proactive Instagram direct-message campaigns.",
  },
  featureCampaigns: { es: "Campañas", en: "Campaigns" },
  featureCampaignsDesc: {
    es: "Envíos masivos por WhatsApp a segmentos de contactos.",
    en: "Bulk WhatsApp sends to contact segments.",
  },
  featureTemplates: { es: "Plantillas", en: "Templates" },
  featureTemplatesDesc: {
    es: "Plantillas de WhatsApp y su aprobación en Meta.",
    en: "WhatsApp templates and their Meta approval.",
  },
  featureAutomations: { es: "Automatizaciones", en: "Automations" },
  featureAutomationsDesc: {
    es: "Reglas de disparador y pasos que corren solas.",
    en: "Trigger-and-step rules that run on their own.",
  },
  featureOrders: { es: "Pedidos", en: "Orders" },
  featureOrdersDesc: {
    es: "Pedidos que la IA crea desde la conversación.",
    en: "Orders the AI creates from the conversation.",
  },
  featureWebchat: { es: "Chat web", en: "Web chat" },
  featureWebchatDesc: {
    es: "El chat que el comercio instala en su tienda.",
    en: "The chat merchants install on their store.",
  },
  featureSaved: { es: "Guardado", en: "Saved" },
  featureSaveError: { es: "No se pudo guardar", en: "Couldn't save" },
  // Experiencias opt-in: arrancan apagadas y se prenden por comercio
  experiencesTitle: { es: "Experiencias", en: "Experiences" },
  experiencesDesc: {
    es: "Versiones nuevas de la aplicación. Arrancan apagadas: lo normal es prenderlas comercio por comercio desde su ficha.",
    en: "New versions of the app. They start off: normally you turn them on per merchant from their detail page.",
  },
  featureRiverz2: { es: "Riverz 2.0 · Operación IA", en: "Riverz 2.0 · AI Operation" },
  featureRiverz2Desc: {
    es: "Centro de operación, Operator y activación guiada en lugar del panel actual.",
    en: "Operation center, Operator and guided activation instead of the current dashboard.",
  },
  featureFlota: { es: "Operator con equipo", en: "Operator with a team" },
  featureFlotaDesc: {
    es: "El chat reparte el pedido entre especialistas por dominio en vez de resolverlo solo. Con esto apagado funciona como siempre.",
    en: "The chat splits the request among domain specialists instead of solving it alone. With this off it works as always.",
  },
  forbidden: { es: "Solo para administradores de la plataforma.", en: "Platform admins only." },
  // Panel de infraestructura (saldo + estado en vivo de todo lo conectado)
  infraTitle: { es: "Infraestructura", en: "Infrastructure" },
  infraDesc: {
    es: "Saldo y estado en vivo de todas las APIs y servicios conectados.",
    en: "Live balance and status of every connected API and service.",
  },
  infraCatLlm: { es: "Modelos de IA (LLMs)", en: "AI models (LLMs)" },
  infraCatVoice: { es: "Voz y telefonía", en: "Voice & telephony" },
  infraCatInfra: { es: "Infraestructura", en: "Infrastructure" },
  infraCatMessaging: { es: "Mensajería", en: "Messaging" },
  infraRefresh: { es: "Actualizar", en: "Refresh" },
  infraLastCheck: { es: "Actualizado", en: "Updated" },
  infraStatusOk: { es: "Operativo", en: "Operational" },
  infraStatusLow: { es: "Saldo bajo", en: "Low balance" },
  infraStatusEmpty: { es: "Sin saldo", en: "No balance" },
  infraStatusError: { es: "Sin respuesta", en: "No response" },
  infraStatusNotConnected: { es: "No conectado", en: "Not connected" },
  infraLoading: { es: "Consultando servicios…", en: "Checking services…" },

  // ── Comunes a las tablas del panel ──
  search: { es: "Buscar", en: "Search" },
  refresh: { es: "Actualizar", en: "Refresh" },
  loading: { es: "Cargando…", en: "Loading…" },
  empty: { es: "Sin resultados", en: "No results" },
  loadError: { es: "No se pudo cargar", en: "Couldn't load" },
  all: { es: "Todos", en: "All" },
  loadMore: { es: "Ver más", en: "Load more" },
  workspace: { es: "Comercio", en: "Merchant" },
  never: { es: "Nunca", en: "Never" },
  readOnlyNote: {
    es: "El panel solo lee: no muestra el contenido de los mensajes ni datos personales de los compradores.",
    en: "This panel is read-only: it never shows message content or shoppers' personal data.",
  },
  rangeLast7: { es: "7 días", en: "7 days" },
  rangeLast30: { es: "30 días", en: "30 days" },
  rangeLast90: { es: "90 días", en: "90 days" },

  // ── Resumen de plataforma ──
  overviewTitle: { es: "Resumen", en: "Overview" },
  overviewDesc: {
    es: "Cómo va la plataforma entera, en los últimos 30 días.",
    en: "How the whole platform is doing, over the last 30 days.",
  },
  kpiWorkspaces: { es: "Comercios activos", en: "Active merchants" },
  kpiWorkspacesNew: { es: "nuevos en el período", en: "new in the period" },
  kpiUsers: { es: "Usuarios", en: "Users" },
  kpiContacts: { es: "Contactos", en: "Contacts" },
  kpiConversations: { es: "Conversaciones", en: "Conversations" },
  kpiMessagesIn: { es: "Mensajes recibidos", en: "Messages received" },
  kpiMessagesOut: { es: "Mensajes enviados", en: "Messages sent" },
  kpiMessagesFailed: { es: "Envíos fallidos", en: "Failed sends" },
  kpiAiSent: { es: "Respuestas de IA", en: "AI replies" },
  kpiAiCost: { es: "Costo de IA", en: "AI cost" },
  kpiCalls: { es: "Llamadas", en: "Calls" },
  kpiCallMinutes: { es: "Minutos de voz", en: "Voice minutes" },
  kpiCallCost: { es: "Costo de voz", en: "Voice cost" },
  kpiOrders: { es: "Pedidos", en: "Orders" },
  alertsTitle: { es: "Requiere atención", en: "Needs attention" },
  alertConnections: {
    es: "conexiones de canal caídas",
    en: "channel connections down",
  },
  alertWebhooks: {
    es: "webhooks sin procesar",
    en: "unprocessed webhooks",
  },
  alertCrons: { es: "trabajos con error", en: "jobs with errors" },
  allClear: { es: "Todo en orden", en: "All clear" },
  chartActivity: { es: "Actividad diaria", en: "Daily activity" },

  // ── Comercios ──
  workspacesTitle: { es: "Comercios", en: "Merchants" },
  workspacesSearch: {
    es: "Nombre o correo del dueño",
    en: "Name or owner email",
  },
  colOwner: { es: "Dueño", en: "Owner" },
  colMembers: { es: "Equipo", en: "Team" },
  colChannels: { es: "Canales", en: "Channels" },
  colContacts: { es: "Contactos", en: "Contacts" },
  colAgents: { es: "Agentes", en: "Agents" },
  colLastActivity: { es: "Última actividad", en: "Last activity" },
  colCreated: { es: "Alta", en: "Created" },
  deletedBadge: { es: "Eliminado", en: "Deleted" },
  workspaceDetailTitle: { es: "Ficha del comercio", en: "Merchant detail" },
  notFound: { es: "No existe", en: "Not found" },
  members: { es: "Equipo", en: "Team" },
  connections: { es: "Conexiones", en: "Connections" },
  agents: { es: "Agentes de IA", en: "AI agents" },
  counts: { es: "Volumen", en: "Volume" },
  countFlows: { es: "Flujos", en: "Flows" },
  countAutomations: { es: "Automatizaciones", en: "Automations" },
  countBroadcasts: { es: "Campañas", en: "Campaigns" },
  countProducts: { es: "Productos", en: "Products" },
  recentErrors: { es: "Errores recientes", en: "Recent errors" },
  roleAdmin: { es: "Administrador", en: "Admin" },
  roleAgent: { es: "Usuario", en: "User" },
  sectionsAll: { es: "Acceso total", en: "Full access" },
  sectionsLimited: { es: "{n} secciones", en: "{n} sections" },
  lastError: { es: "Último error", en: "Last error" },
  lastSync: { es: "Última sincronización", en: "Last sync" },
  qualityRating: { es: "Calidad", en: "Quality" },
  tier: { es: "Límite de envío", en: "Send tier" },
  agentActive: { es: "Activo", en: "Active" },
  agentPaused: { es: "Pausado", en: "Paused" },

  // ── Usuarios ──
  usersTitle: { es: "Usuarios", en: "Users" },
  usersSearch: { es: "Nombre o correo", en: "Name or email" },
  colEmail: { es: "Correo", en: "Email" },
  colName: { es: "Nombre", en: "Name" },
  colWorkspaces: { es: "Comercios", en: "Merchants" },
  colLocale: { es: "Idioma", en: "Language" },
  colTerms: { es: "Términos", en: "Terms" },
  platformAdminBadge: { es: "Equipo Riverz", en: "Riverz team" },
  ownerBadge: { es: "Dueño", en: "Owner" },

  // ── Registros ──
  logsTitle: { es: "Registros", en: "Logs" },
  logKindAi: { es: "IA", en: "AI" },
  logKindAutomations: { es: "Automatizaciones", en: "Automations" },
  logKindFlows: { es: "Flujos", en: "Flows" },
  logKindMessages: { es: "Envíos fallidos", en: "Failed sends" },
  logKindTemplates: { es: "Plantillas", en: "Templates" },
  logKindBroadcasts: { es: "Campañas", en: "Campaigns" },
  logKindWebhooks: { es: "Webhooks", en: "Webhooks" },
  logKindConnections: { es: "Conexiones", en: "Connections" },
  logKindCrons: { es: "Trabajos", en: "Jobs" },
  logKindApprovals: { es: "Aprobaciones", en: "Approvals" },
  logKindCommentToDm: { es: "Comentarios a DM", en: "Comment to DM" },
  logKindIgProactive: { es: "IG proactivo", en: "Proactive IG" },
  logKindVoice: { es: "Voz", en: "Voice" },
  logsAiHint: {
    es: "Cuando la IA no contesta, el motivo queda acá.",
    en: "When the AI doesn't reply, the reason lands here.",
  },
  colWhen: { es: "Cuándo", en: "When" },
  colStatus: { es: "Estado", en: "Status" },
  colDetail: { es: "Detalle", en: "Detail" },

  // ── Operación ──
  opsTitle: { es: "Operación", en: "Operations" },
  opsCrons: { es: "Trabajos programados", en: "Scheduled jobs" },
  opsWebhooks: { es: "Cola de webhooks", en: "Webhook queue" },
  colJob: { es: "Trabajo", en: "Job" },
  colSchedule: { es: "Frecuencia", en: "Schedule" },
  colLastRun: { es: "Última corrida", en: "Last run" },
  colDuration: { es: "Duración", en: "Duration" },
  colRuns24h: { es: "24 h", en: "24 h" },
  cronStale: { es: "Sin reportar", en: "Not reporting" },
  webhooksUnprocessed: { es: "sin procesar", en: "unprocessed" },

  // El reloj interno. Sin él, todos los demás números son de antes.
  schedulerBeat: { es: "Reloj interno", en: "Internal clock" },
  schedulerAlive: { es: "Latiendo", en: "Beating" },
  schedulerDead: { es: "Detenido", en: "Stopped" },
  schedulerRunning: { es: "Corriendo ahora", en: "Running now" },
  schedulerDeadNote: {
    es: "Ningún trabajo de fondo se está disparando: ni campañas, ni carritos, ni seguimientos.",
    en: "No background job is firing: no campaigns, no cart recovery, no follow-ups.",
  },

  // Qué hace cada trabajo, en una línea.
  cronFlowsResume: { es: "Reanuda flujos en espera", en: "Resumes waiting flows" },
  cronAutomations: {
    es: "Drena pasos de espera de automatizaciones",
    en: "Drains automation wait steps",
  },
  cronFlowsRetries: {
    es: "Reintenta ejecuciones de flujo fallidas",
    en: "Retries failed flow runs",
  },
  cronBroadcasts: { es: "Envía campañas programadas", en: "Sends scheduled campaigns" },
  cronVoiceCalls: { es: "Despacha llamadas en cola", en: "Dispatches queued calls" },
  cronVoiceCampaignRun: { es: "Avanza campañas de voz", en: "Advances voice campaigns" },
  cronInstagramAgent: {
    es: "Motor de DMs proactivos de Instagram",
    en: "Instagram proactive DM engine",
  },
  cronOutlookPoll: { es: "Sondea buzones de Outlook", en: "Polls Outlook mailboxes" },
  cronGmailPoll: { es: "Sondea buzones de Gmail", en: "Polls Gmail mailboxes" },
  cronMercadolibre: {
    es: "Preguntas, pedidos, envíos, reclamos y catálogo de Mercado Libre",
    en: "Mercado Libre questions, orders, shipping, claims and catalog",
  },
  cronCommentSync: {
    es: "Sincroniza comentarios de Facebook e Instagram",
    en: "Syncs Facebook and Instagram comments",
  },
  cronCommentReconcile: {
    es: "Reconcilia comentarios borrados u ocultados",
    en: "Reconciles deleted or hidden comments",
  },
  cronContactsSync: {
    es: "Completa datos de contactos desde la tienda",
    en: "Fills in contact data from the store",
  },
  cronTiktokComments: {
    es: "Trae los comentarios nuevos de TikTok",
    en: "Brings in new TikTok comments",
  },
  cronTiktokWebhook: {
    es: "Registra en TikTok a dónde avisar los comentarios",
    en: "Tells TikTok where to send comment events",
  },
  cronTiktokDeep: {
    es: "Repasa todos los videos de TikTok, no solo los nuevos",
    en: "Sweeps every TikTok video, not just the newest",
  },
  cronInstagramEnrich: {
    es: "Enriquece perfiles públicos de Instagram",
    en: "Enriches public Instagram profiles",
  },
  cronFlowsSweep: { es: "Barre flujos vencidos por tiempo", en: "Sweeps timed-out flows" },
  cronKlaviyoSync: { es: "Espeja los contactos hacia Klaviyo", en: "Mirrors contacts to Klaviyo" },
  cronAiFollowups: {
    es: "Seguimientos de la IA cuando el cliente calla",
    en: "AI follow-ups when the customer goes quiet",
  },
  cronMercadopagoSync: {
    es: "Trae los pagos rechazados de Mercado Pago",
    en: "Pulls rejected Mercado Pago payments",
  },
  cronDeliveryWatchdog: { es: "Marca envíos sin confirmar", en: "Flags unconfirmed deliveries" },
  cronAdsSync: {
    es: "Marca qué comentarios vienen de un anuncio",
    en: "Flags which comments came from an ad",
  },
  cronShopifyCartRecovery: { es: "Recupera carritos abandonados", en: "Recovers abandoned carts" },
  cronTiendanubeCheckouts: {
    es: "Descubre carritos abandonados de Tiendanube",
    en: "Finds abandoned Tiendanube carts",
  },
  cronMercadopagoRecovery: {
    es: "Recupera pagos rechazados de Mercado Pago",
    en: "Recovers rejected Mercado Pago payments",
  },
  cronShopifyFeedback: { es: "Pide opinión tras la entrega", en: "Asks for feedback after delivery" },
  cronMetaContactNames: {
    es: "Completa nombres de contactos de Meta",
    en: "Fills in Meta contact names",
  },
  cronMetaWebhookSubs: {
    es: "Reaplica suscripciones de webhooks de Meta",
    en: "Re-applies Meta webhook subscriptions",
  },
  cronCommerceWebhooks: {
    es: "Repunta los webhooks de las tiendas al dominio actual",
    en: "Repoints store webhooks at the current domain",
  },
  cronGmailWatch: { es: "Renueva la suscripción push de Gmail", en: "Renews the Gmail push subscription" },
  cronCatalogEnrich: {
    es: "Le lee la página a los productos nuevos y une los repetidos entre plataformas",
    en: "Reads new products' pages and merges the ones duplicated across platforms",
  },
  cronOutlookWatch: {
    es: "Renueva la suscripción push de Outlook",
    en: "Renews the Outlook push subscription",
  },
  cronMetaDmBackfill: {
    es: "Reingesta historial de mensajes de Meta",
    en: "Re-ingests Meta message history",
  },
  cronPiiPurge: {
    es: "Borra datos personales de comercios eliminados",
    en: "Deletes personal data from removed accounts",
  },
  cronIssuesAlert: {
    es: "Avisa al comercio lo que se rompió en silencio",
    en: "Emails each account what broke silently",
  },
  cronMetaTokenRefresh: { es: "Renueva el token de Facebook Login", en: "Renews the Facebook Login token" },
  cronReengagement: { es: "Reengancha compradores inactivos", en: "Re-engages dormant buyers" },
  cronMlOrders: {
    es: "Pedidos, envíos y reclamos de Mercado Libre",
    en: "Mercado Libre orders, shipping and claims",
  },
  cronMlCatalog: { es: "Precio y stock de Mercado Libre", en: "Mercado Libre price and stock" },
  cronMlReviews: { es: "Opiniones de Mercado Libre", en: "Mercado Libre reviews" },
  cronPlatformWatch: {
    es: "Avisa al equipo lo que se acaba de romper",
    en: "Alerts the team about anything that just broke",
  },
  colProvider: { es: "Origen", en: "Source" },
  colAttempts: { es: "Intentos", en: "Attempts" },

  // ── Uso y costos ──
  usageTitle: { es: "Uso y costos", en: "Usage & cost" },
  usageDesc: {
    es: "Costo estimado con precios de lista, sin descuentos por caché.",
    en: "Estimated at list prices, without cache discounts.",
  },
  colMessagesOut: { es: "Enviados", en: "Sent" },
  colAiSent: { es: "Respuestas IA", en: "AI replies" },
  colTokens: { es: "Tokens", en: "Tokens" },
  colAiCost: { es: "Costo IA", en: "AI cost" },
  colCalls: { es: "Llamadas", en: "Calls" },
  colMinutes: { es: "Minutos", en: "Minutes" },
  colVoiceCost: { es: "Costo voz", en: "Voice cost" },
  colOrders: { es: "Pedidos", en: "Orders" },
  totals: { es: "Total", en: "Total" },

  // ── Canales ──
  channelsTitle: { es: "Canales", en: "Channels" },
  colChannel: { es: "Canal", en: "Channel" },
  colAccount: { es: "Cuenta", en: "Account" },
  statusConnected: { es: "Conectado", en: "Connected" },
  statusDisconnected: { es: "Desconectado", en: "Disconnected" },
  statusError: { es: "Con error", en: "Error" },
  statusPending: { es: "Pendiente", en: "Pending" },
  statusExpired: { es: "Vencido", en: "Expired" },

  // ── Auditoría ──
  auditTitle: { es: "Auditoría", en: "Audit" },
  auditDesc: {
    es: "Cada pantalla que el equipo abre queda registrada.",
    en: "Every screen the team opens is recorded.",
  },
  colActor: { es: "Quién", en: "Who" },
  colWorkspace: { es: "Comercio", en: "Merchant" },
  // Detalle de cada servicio en /admin/infra. Van como clave y no como texto:
  // el módulo que las produce corre en el servidor y no sabe en qué idioma se
  // está mirando el panel.
  svcNoData: { es: "sin datos", en: "no data" },
  svcNoAnswer: { es: "no responde", en: "not responding" },
  svcNoProject: { es: "sin proyecto", en: "no project" },
  svcNoCredit: { es: "sin saldo", en: "out of credit" },
  svcRateLimited: { es: "límite de uso", en: "rate limited" },
  svcHttpError: { es: "respondió con error", en: "responded with an error" },
  svcActive: { es: "activo", en: "active" },
  svcOperational: { es: "operativo", en: "operational" },
  svcAllUp: { es: "todos activos", en: "all up" },
  svcSuspended: { es: "hay servicios suspendidos", en: "some services suspended" },
  svcTelephony: { es: "telefonía", en: "telephony" },
  svcStt: { es: "transcripción + voz Celeste", en: "transcription + Celeste voice" },
  svcTts: { es: "voz S2.1", en: "S2.1 voice" },
  svcTtsFree: { es: "voz S2.1 · sólo el modelo gratis", en: "S2.1 voice · free model only" },
  svcTtsPremium: { es: "voz premium (no en uso)", en: "premium voice (unused)" },
  svcTextBot: { es: "bot de texto + investigación", en: "text bot + research" },
  svcCallOrchestration: { es: "orquestación de llamadas", en: "call orchestration" },
  svcVoiceLlm: { es: "LLM de voz (rápido)", en: "voice LLM (fast)" },
  svcBackupLlm: { es: "LLM de respaldo", en: "backup LLM" },
  svcGpt: { es: "GPT", en: "GPT" },
  svcEmail: { es: "lista de espera y avisos", en: "waitlist and alerts" },
  svcPlatformWa: {
    es: "por acá salen las preguntas al comercio",
    en: "this is how we ask the merchant",
  },

  // Pantalla de desbloqueo. Es lo primero que se ve en admin.riverz.co, y era
  // una de las dos que no pasaban por i18n.
  unlockTitle: { es: "Panel de plataforma", en: "Platform panel" },
  unlockPlaceholder: { es: "Contraseña del panel", en: "Panel password" },
  unlockSubmit: { es: "Entrar", en: "Enter" },
  unlockFailed: { es: "No se pudo abrir", en: "Couldn't unlock" },
  unlockNetwork: { es: "Error de red", en: "Network error" },
  unlockNotConfigured: {
    es: "Falta definir ADMIN_PANEL_PASSWORD en el servidor. Sin esa contraseña el panel no se abre para nadie.",
    en: "ADMIN_PANEL_PASSWORD isn't set on the server. Without it the panel opens for nobody.",
  },

  // WhatsApp de la plataforma. Era la otra pantalla que no pasaba por i18n.
  waPlatformTitle: { es: "WhatsApp de Riverz", en: "Riverz WhatsApp" },
  waPlatformDesc: {
    es: "El número con el que la plataforma le avisa a los comercios cuando algo se rompe. Es aparte del de cada cuenta a propósito: el aviso más importante es justo el que el número del comercio no podría entregar.",
    en: "The number the platform uses to tell merchants something broke. Separate from each account's own number on purpose: the alert that matters most is exactly the one their number couldn't deliver.",
  },
  waNeedsMigration: {
    es: "Falta aplicar la migración 147_platform_whatsapp.sql. Hasta entonces sólo se puede configurar por variables de entorno.",
    en: "Migration 147_platform_whatsapp.sql hasn't been applied. Until then it can only be set through environment variables.",
  },
  waConnectTitle: { es: "Conectar con Meta", en: "Connect with Meta" },
  waConnectHint: {
    es: "Abre el registro de WhatsApp Business de Meta y trae el número y el token sin copiar nada.",
    en: "Opens Meta's WhatsApp Business signup and brings the number and token over without copying anything.",
  },
  waReconnectNote: {
    es: "Volver a conectarlo reemplaza el token guardado.",
    en: "Reconnecting replaces the saved token.",
  },
  waConnect: { es: "Conectar WhatsApp de Riverz", en: "Connect Riverz WhatsApp" },
  waReconnect: { es: "Volver a conectar", en: "Reconnect" },
  waManual: { es: "Cargar los datos a mano", en: "Enter the details by hand" },
  waPhoneId: { es: "ID del número (phone_number_id)", en: "Number ID (phone_number_id)" },
  waPhoneIdHint: { es: "Meta → WhatsApp → API Setup", en: "Meta → WhatsApp → API Setup" },
  waWabaId: {
    es: "ID de la cuenta de WhatsApp Business (WABA)",
    en: "WhatsApp Business Account ID (WABA)",
  },
  waDisplay: { es: "Número, como se muestra", en: "Number, as displayed" },
  waToken: { es: "Token permanente", en: "Permanent token" },
  waTokenSaved: {
    es: "Ya hay uno guardado — escribe otro sólo si lo cambias",
    en: "One is already saved — type a new one only to replace it",
  },
  waTokenHint: { es: "Token del System User", en: "System User token" },
  waTemplate: { es: "Plantilla de aviso", en: "Alert template" },
  waTemplateHint: {
    es: "Utility aprobada. Las Marketing las retiene Meta.",
    en: "An approved Utility template. Meta holds back Marketing ones.",
  },
  waNotify: { es: "Avisar por WhatsApp", en: "Alert over WhatsApp" },
  waNotifyHint: {
    es: "Apagado, los avisos siguen saliendo sólo por correo.",
    en: "Off, alerts still go out by email only.",
  },

  voiceCustom: { es: "Otro…", en: "Other…" },
  voiceProviderId: { es: "id del proveedor", en: "provider id" },
  voiceModelId: { es: "id del modelo", en: "model id" },

  // La puerta MCP: un agente operando sobre las cuentas.
  mcpTitle: { es: "Operación por agente (MCP)", en: "Agent access (MCP)" },
  mcpOn: { es: "Puerta abierta", en: "Door open" },
  mcpOff: { es: "Cerrada (sin clave)", en: "Closed (no key)" },
  mcpCalls: { es: "{n} llamada(s) en 7 días", en: "{n} call(s) in 7 days" },
  mcpFailed: { es: "{n} fallaron", en: "{n} failed" },
  mcpHint: {
    es: "Todo lo que hace queda en Auditoría → Agente, incluidas las lecturas. Lo irreversible pide confirmación antes de ejecutarse.",
    en: "Everything it does lands in Audit → Agent, reads included. Irreversible actions ask for confirmation first.",
  },

  saveFailed: { es: "No se pudo guardar", en: "Couldn't save" },

  lockPanel: { es: "Cerrar el panel", en: "Lock the panel" },

  // Excepciones de funcionalidad por comercio.
  wsFeaturesTitle: { es: "Funcionalidades de este comercio", en: "Features for this merchant" },
  wsFeaturesDesc: {
    es: "Cada una sigue el valor global salvo que acá se diga otra cosa.",
    en: "Each one follows the global value unless overridden here.",
  },
  wsFeatureFollow: { es: "Global", en: "Global" },
  wsFeatureOn: { es: "Prendida", en: "On" },
  wsFeatureOff: { es: "Apagada", en: "Off" },
  wsFeatureGlobalOn: { es: "Global: prendida", en: "Global: on" },
  wsFeatureGlobalOff: { es: "Global: apagada", en: "Global: off" },

  live: { es: "En vivo", en: "Live" },
  liveHint: {
    es: "Se actualiza solo cada 30 segundos mientras miras esta pestaña.",
    en: "Refreshes itself every 30 seconds while this tab is open.",
  },
  colHealth: { es: "Salud", en: "Health" },
  colCanSend: { es: "Puede enviar", en: "Can send" },
  waCanSend: { es: "Sí", en: "Yes" },
  waLimited: { es: "Limitado", en: "Limited" },
  waBlocked: { es: "Bloqueado", en: "Blocked" },
  healthOk: { es: "Sin problemas", en: "All good" },
  healthIssues: { es: "{n} problema(s)", en: "{n} issue(s)" },
  alertWorkspacesBroken: {
    es: "comercios con algo roto ahora mismo",
    en: "merchants with something broken right now",
  },
  colTool: { es: "Herramienta", en: "Tool" },
  colRisk: { es: "Riesgo", en: "Risk" },
  colSummary: { es: "Qué pasó", en: "What happened" },
  filterActor: { es: "Filtrar por quién", en: "Filter by who" },
  filterWorkspace: { es: "Id de comercio", en: "Merchant id" },
  filterAnyStatus: { es: "Cualquier estado", en: "Any status" },
  auditSourcePanel: { es: "Panel", en: "Panel" },
  auditSourceAgent: { es: "Agente", en: "Agent" },
  risk_lectura: { es: "Lectura", en: "Read" },
  risk_reversible: { es: "Reversible", en: "Reversible" },
  risk_irreversible: { es: "Irreversible", en: "Irreversible" },
  colAction: { es: "Qué", en: "What" },
  colTarget: { es: "Sobre", en: "On" },

  // ── Lista de espera ──
  waitlistTitle: { es: "Lista de espera", en: "Waitlist" },
  colSource: { es: "Origen", en: "Source" },

  // ── Clave de IA de la plataforma ──
  sectionAiKey: { es: "IA", en: "AI" },
  sectionPlatformWhatsapp: { es: "WhatsApp", en: "WhatsApp" },
  sectionPlatformWhatsappDesc: {
    es: "El número con el que Riverz avisa a los comercios. Aparte del de cada cuenta.",
    en: "The number Riverz uses to alert merchants. Separate from each account's own.",
  },
  sectionAiKeyDesc: {
    es: "Quién paga la IA de cada cuenta",
    en: "Who pays for each account's AI",
  },
  aiKeyTitle: { es: "Clave de IA", en: "AI key" },
  aiKeySubtitle: {
    es: "Riverz pone la clave y decide a qué cuentas cubre. Las demás traen la suya.",
    en: "Riverz supplies the key and decides which accounts it covers. The rest bring their own.",
  },
  aiKeyTheKey: { es: "Clave de Anthropic", en: "Anthropic key" },
  aiKeyLoaded: { es: "cargada", en: "loaded" },
  aiKeyReplace: { es: "Pegar una clave nueva para reemplazarla", en: "Paste a new key to replace it" },
  aiKeyWhoTitle: { es: "A quién cubre", en: "Who it covers" },
  aiKeyModeAll: { es: "Todas", en: "All" },
  aiKeyModeAllHint: {
    es: "Cualquier cuenta usa la clave de Riverz",
    en: "Every account uses the Riverz key",
  },
  aiKeyModeSelected: { es: "Solo las elegidas", en: "Selected only" },
  aiKeyModeSelectedHint: {
    es: "El resto trae la suya",
    en: "The rest bring their own",
  },
  aiKeyModeOff: { es: "Ninguna", en: "None" },
  aiKeyModeOffHint: { es: "Todas traen la suya", en: "Everyone brings their own" },
  aiKeySpendPlatform: { es: "Paga Riverz · {days} días", en: "Riverz pays · {days} days" },
  aiKeySpendOwn: { es: "Paga el comercio · {days} días", en: "Merchant pays · {days} days" },
  aiKeyCovered: { es: "Cuentas cubiertas", en: "Accounts covered" },
  aiKeyByAccount: { es: "Por cuenta", en: "By account" },
  aiKeyColAccount: { es: "Cuenta", en: "Account" },
  aiKeyColCalls: { es: "Respuestas", en: "Replies" },
  aiKeyColRiverz: { es: "Paga Riverz", en: "Riverz pays" },
  aiKeyColOwn: { es: "Paga el comercio", en: "Merchant pays" },
  aiKeyColCovered: { es: "Cubierta", en: "Covered" },
  aiKeyAllOn: { es: "Todas", en: "All" },
  aiKeySaved: { es: "Guardado", en: "Saved" },
  aiKeySaveError: { es: "No se pudo guardar", en: "Could not save" },
  aiKeyNoFallback: {
    es: "{name} queda sin clave propia: dejará de responder",
    en: "{name} has no key of its own: it will stop replying",
  },

  // Interruptor del cobro manual
  suspendTitle: { es: "Acceso de la cuenta", en: "Account access" },
  suspendActive: { es: "Activa.", en: "Active." },
  suspendedSince: { es: "Suspendida el {date}.", en: "Suspended on {date}." },
  suspendReasonPlaceholder: {
    es: "Motivo (nota interna, opcional)",
    en: "Reason (internal note, optional)",
  },
  suspendCta: { es: "Suspender", en: "Suspend" },
  resumeCta: { es: "Reactivar", en: "Reactivate" },
  suspendDone: { es: "Cuenta suspendida", en: "Account suspended" },
  resumeDone: { es: "Cuenta reactivada", en: "Account reactivated" },
  suspendError: { es: "No se pudo cambiar", en: "Couldn't change it" },
  suspendHint: {
    es: "Suspender saca al comercio del panel y frena sus envíos automáticos. No borra nada: lo que llegue se sigue guardando.",
    en: "Suspending locks the merchant out of the dashboard and stops their automated sends. Nothing is deleted: incoming data is still stored.",
  },
} satisfies Namespace;
