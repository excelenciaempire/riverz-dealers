import type { Namespace } from './types';

/** Panel de plataforma (riverz.co/admin) — solo equipo Riverz. */
export const admin = {
  unlockUnconfigured: { es: 'El panel no tiene contraseña configurada.', en: 'The panel password has not been configured.' },
  unlockIncorrect: { es: 'Contraseña incorrecta', en: 'Incorrect password' },
  unlockRateLimited: { es: 'Demasiados intentos. Inténtalo más tarde.', en: 'Too many attempts. Try again later.' },
  syncPending: { es: 'Sincronización pendiente', en: 'Sync pending' },
  syncLiveOnly: { es: 'Eventos en vivo; sin historial recuperable', en: 'Live events; history unavailable' },
  cronWalletReconciliation: {
    es: 'Revisa consumos pendientes y recupera recargas cobradas.',
    en: 'Checks pending usage and recovers paid top-ups.',
  },
  title: { es: 'Admin', en: 'Admin' },
  subtitle: {
    es: 'Ajustes globales de la plataforma',
    en: 'Platform-wide settings',
  },
  backToApp: { es: 'Volver a la app', en: 'Back to app' },
  backToIndex: { es: 'Volver', en: 'Back' },
  // Grupos del índice
  groupWorkspaces: { es: 'Comercios', en: 'Merchants' },
  groupMoney: { es: 'La plata', en: 'Money' },
  groupApis: { es: 'Las APIs', en: 'APIs' },
  sectionSignup: { es: 'Alta', en: 'Sign-up' },
  sectionSignupDesc: {
    es: 'Los códigos que abren la puerta y quién quedó esperando.',
    en: "The codes that open the door and who's still waiting.",
  },
  groupObservability: { es: 'Qué está pasando', en: "What's happening" },
  groupConfig: { es: 'Configuración', en: 'Configuration' },
  // Secciones
  sectionWorkspaces: { es: 'Comercios', en: 'Merchants' },
  sectionWorkspacesDesc: {
    es: 'Todas las cuentas: dueño, equipo, canales y actividad.',
    en: 'Every account: owner, team, channels and activity.',
  },
  sectionUsers: { es: 'Usuarios', en: 'Users' },
  sectionUsersDesc: {
    es: 'Personas registradas y los comercios a los que pertenecen.',
    en: 'Registered people and the merchants they belong to.',
  },
  sectionUsage: { es: 'Uso y costos', en: 'Usage & cost' },
  sectionUsageDesc: {
    es: 'Mensajes, tokens de IA, minutos de voz y su costo por comercio.',
    en: 'Messages, AI tokens, voice minutes and their cost per merchant.',
  },
  sectionWaitlist: { es: 'Lista de espera', en: 'Waitlist' },
  sectionWaitlistDesc: {
    es: 'Interesados que dejaron su correo antes del lanzamiento.',
    en: 'People who left their email before launch.',
  },
  sectionLogs: { es: 'Registros', en: 'Logs' },
  sectionLogsDesc: {
    es: 'Por qué la IA no respondió, qué envío falló y qué webhook quedó trabado.',
    en: "Why the AI didn't reply, which send failed, which webhook got stuck.",
  },
  // «Canales» quedaba corto: la tabla no lista canales sino CONEXIONES —una
  // fila por cuenta conectada de cada comercio— y ahí adentro hay tiendas,
  // pagos y contra reembolso además de mensajería.
  sectionConnections: { es: 'Conexiones', en: 'Connections' },
  sectionConnectionsDesc: {
    es: 'Cada cuenta que un comercio tiene conectada, y su último error.',
    en: 'Every account a merchant has connected, and its last error.',
  },

  // Recursos que el equipo entrega a un comercio
  resourcesTitle: { es: 'Recursos', en: 'Resources' },
  wooPluginDesc: {
    es: 'Plugin de WordPress: agrega los carritos que se abandonan antes de enviar el pedido.',
    en: 'WordPress plugin: adds the carts abandoned before the order is placed.',
  },
  wooPluginDownload: {
    es: 'Descargar plugin de WooCommerce',
    en: 'Download WooCommerce plugin',
  },
  wooPluginNoSecret: {
    es: 'Copia sin credenciales. Cada comercio baja la suya ya configurada desde Ajustes → Canales.',
    en: 'Copy without credentials. Each merchant downloads a preconfigured one from Settings → Channels.',
  },
  sectionOps: { es: 'Operación', en: 'Operations' },
  sectionOpsDesc: {
    es: 'El reloj, los trabajos de fondo y el historial de todo lo que corrió.',
    en: 'The clock, the background jobs and the history of everything that ran.',
  },
  prepareOperationTitle: { es: 'Preparar operación', en: 'Prepare operation' },
  prepareOperationHint: {
    es: 'Crea un borrador seguro en esta cuenta. El comercio conecta sus canales y valida antes de activar.',
    en: 'Creates a safe draft in this account. The merchant connects channels and validates before activation.',
  },
  prepareOperationWebsite: { es: 'Sitio web', en: 'Website' },
  prepareOperationCountry: { es: 'País', en: 'Country' },
  prepareOperationLanguage: { es: 'Idioma', en: 'Language' },
  prepareOperationChannel: { es: 'Canal objetivo', en: 'Target channel' },
  prepareOperationPlatform: {
    es: 'Plataforma de tienda',
    en: 'Store platform',
  },
  prepareOperationCheckout: { es: 'Forma de cobro', en: 'Checkout method' },
  prepareOperationPayments: { es: 'Medios de pago', en: 'Payment methods' },
  prepareOperationGoal: { es: 'Objetivo inicial', en: 'Initial goal' },
  prepareOperationGeneral: { es: 'General', en: 'General' },
  prepareOperationRegulated: { es: 'Regulado', en: 'Regulated' },
  prepareOperationVertical: { es: 'Tipo de operación', en: 'Operation type' },
  prepareOperationSales: { es: 'Ventas', en: 'Sales' },
  prepareOperationAftersale: { es: 'Postventa', en: 'After-sales' },
  prepareOperationRecovery: { es: 'Recuperación', en: 'Recovery' },
  prepareOperationAction: { es: 'Preparar', en: 'Prepare' },
  prepareOperationDone: { es: 'Operación preparada', en: 'Operation prepared' },
  prepareOperationError: {
    es: 'No se pudo preparar la operación',
    en: "Couldn't prepare the operation",
  },
  operationHealthTitle: { es: 'Salud de la operación', en: 'Operation health' },
  operationHealthProfile: { es: 'Perfil operativo', en: 'Operating profile' },
  operationHealthValidation: {
    es: 'Última validación',
    en: 'Latest validation',
  },
  operationHealthReplies: { es: 'Respuestas IA, 24 h', en: 'AI replies, 24 h' },
  operationHealthHandoffs: { es: 'Derivaciones, 24 h', en: 'Hand-offs, 24 h' },
  operationHealthNoProfile: { es: 'Pendiente', en: 'Pending' },
  operationHealthNoValidation: { es: 'Sin validar', en: 'Not validated' },
  operationHealthPassed: { es: 'Aprobada', en: 'Passed' },
  operationHealthWarning: { es: 'Con revisión humana', en: 'Human review' },
  operationHealthBlocked: { es: 'Bloqueada', en: 'Blocked' },
  // Las dos distancias del mismo tema: qué está corriendo, y qué corrió.
  opsTabNow: { es: 'Ahora', en: 'Now' },
  opsTabHistory: { es: 'Historial', en: 'History' },
  sectionAudit: { es: 'Auditoría', en: 'Audit' },
  sectionAuditDesc: {
    es: 'Qué miró y qué cambió cada miembro del equipo.',
    en: 'What each team member viewed and changed.',
  },
  sectionVoice: { es: 'Modelo de voz', en: 'Voice model' },
  sectionVoiceDesc: {
    es: 'Stack STT · LLM · TTS que usan todas las cuentas.',
    en: 'STT · LLM · TTS stack used by every account.',
  },
  // Funcionalidades (feature flags)
  sectionFeatures: { es: 'Funcionalidades', en: 'Features' },
  sectionFeaturesDesc: {
    es: 'Prende o apaga funciones de la app para todas las cuentas.',
    en: 'Turn app features on or off for every account.',
  },
  featuresTitle: { es: 'Funcionalidades', en: 'Features' },
  featuresDesc: {
    es: 'Apagarla la esconde del menú y bloquea su URL. Los admins la siguen viendo.',
    en: 'Turning it off hides it from the menu and blocks its URL. Admins still see it.',
  },
  featureFlows: { es: 'Flujos', en: 'Flows' },
  featureFlowsDesc: {
    es: 'Constructor visual de flujos/menús conversacionales.',
    en: 'Visual builder for conversational flows/menus.',
  },
  featureVoice: { es: 'Voz', en: 'Voice' },
  featureVoiceDesc: {
    es: 'Llamadas con agentes de IA y campañas de voz.',
    en: 'AI agent phone calls and voice campaigns.',
  },
  featureComments: { es: 'Comentarios', en: 'Comments' },
  featureCommentsDesc: {
    es: 'Moderación y respuesta automatica de comentarios de Instagram y Facebook.',
    en: 'Moderation and auto-reply for Instagram and Facebook comments.',
  },
  featureInstagramAgent: { es: 'Ventas por Instagram', en: 'Instagram sales' },
  featureInstagramAgentDesc: {
    es: 'Campañas proactivas de mensajes directos en Instagram.',
    en: 'Proactive Instagram direct-message campaigns.',
  },
  featureCampaigns: { es: 'Campañas', en: 'Campaigns' },
  featureCampaignsDesc: {
    es: 'Envíos masivos por WhatsApp a segmentos de contactos.',
    en: 'Bulk WhatsApp sends to contact segments.',
  },
  featureTemplates: { es: 'Plantillas', en: 'Templates' },
  featureTemplatesDesc: {
    es: 'Plantillas de WhatsApp y su aprobación en Meta.',
    en: 'WhatsApp templates and their Meta approval.',
  },
  featureAutomations: { es: 'Automatizaciones', en: 'Automations' },
  featureAutomationsDesc: {
    es: 'Reglas de disparador y pasos que corren solas.',
    en: 'Trigger-and-step rules that run on their own.',
  },
  featureOrders: { es: 'Pedidos', en: 'Orders' },
  featureOrdersDesc: {
    es: 'Pedidos que la IA crea desde la conversación.',
    en: 'Orders the AI creates from the conversation.',
  },
  featureWebchat: { es: 'Chat web', en: 'Web chat' },
  featureWebchatDesc: {
    es: 'El chat que el comercio instala en su tienda.',
    en: 'The chat merchants install on their store.',
  },
  featureSaved: { es: 'Guardado', en: 'Saved' },
  featureSaveError: { es: 'No se pudo guardar', en: "Couldn't save" },
  featureInvalidInput: { es: 'La configuración de la funcionalidad no es válida.', en: 'The feature configuration is invalid.' },
  // Experiencias opt-in: arrancan apagadas y se prenden por comercio
  experiencesTitle: { es: 'Experiencias', en: 'Experiences' },
  experiencesDesc: {
    es: 'Arrancan apagadas. Se prenden comercio por comercio desde su ficha.',
    en: 'They start off. Turn them on per merchant from their detail page.',
  },
  featureRiverz2: {
    es: 'Riverz 2.0 · Operación IA',
    en: 'Riverz 2.0 · AI Operation',
  },
  featureRiverz2Desc: {
    es: 'Centro de operación, Operator y activación guiada en lugar del panel actual.',
    en: 'Operation center, Operator and guided activation instead of the current dashboard.',
  },
  featureFlota: { es: 'Operator con equipo', en: 'Operator with a team' },
  featureFlotaDesc: {
    es: 'El chat reparte el pedido entre especialistas por dominio.',
    en: 'The chat splits the request among domain specialists.',
  },
  forbidden: {
    es: 'Solo para administradores de la plataforma.',
    en: 'Platform admins only.',
  },
  // Panel de infraestructura (saldo + estado en vivo de todo lo conectado)
  infraTitle: { es: 'Infraestructura', en: 'Infrastructure' },
  infraDesc: {
    es: 'Saldo y estado en vivo de todas las APIs y servicios conectados.',
    en: 'Live balance and status of every connected API and service.',
  },
  infraCatLlm: { es: 'Modelos de IA (LLMs)', en: 'AI models (LLMs)' },
  infraCatVoice: { es: 'Voz y telefonía', en: 'Voice & telephony' },
  infraCatInfra: { es: 'Infraestructura', en: 'Infrastructure' },
  infraCatMessaging: { es: 'Mensajería', en: 'Messaging' },
  infraRefresh: { es: 'Actualizar', en: 'Refresh' },
  infraLastCheck: { es: 'Actualizado', en: 'Updated' },
  infraStatusOk: { es: 'Operativo', en: 'Operational' },
  infraStatusLow: { es: 'Saldo bajo', en: 'Low balance' },
  infraStatusEmpty: { es: 'Sin saldo', en: 'No balance' },
  infraStatusError: { es: 'Sin respuesta', en: 'No response' },
  infraStatusNotConnected: { es: 'No conectado', en: 'Not connected' },
  infraLoading: { es: 'Consultando servicios…', en: 'Checking services…' },

  // ── Comunes a las tablas del panel ──
  search: { es: 'Buscar', en: 'Search' },
  refresh: { es: 'Actualizar', en: 'Refresh' },
  loading: { es: 'Cargando…', en: 'Loading…' },
  empty: { es: 'Sin resultados', en: 'No results' },
  loadError: { es: 'No se pudo cargar', en: "Couldn't load" },
  all: { es: 'Todos', en: 'All' },
  loadMore: { es: 'Ver más', en: 'Load more' },
  workspace: { es: 'Comercio', en: 'Merchant' },
  never: { es: 'Nunca', en: 'Never' },
  readOnlyNote: {
    es: 'El panel solo lee: no muestra el contenido de los mensajes ni datos personales de los compradores.',
    en: "This panel is read-only: it never shows message content or shoppers' personal data.",
  },
  rangeToday: { es: 'Hoy', en: 'Today' },
  rangeYesterday: { es: 'Ayer', en: 'Yesterday' },
  rangeLast7: { es: '7 días', en: '7 days' },
  rangeLast30: { es: '30 días', en: '30 days' },
  rangeLast90: { es: '90 días', en: '90 days' },

  // ── Resumen de plataforma ──
  overviewTitle: { es: 'Resumen', en: 'Overview' },
  overviewDesc: {
    es: 'Cómo va la plataforma entera, en los últimos 30 días.',
    en: 'How the whole platform is doing, over the last 30 days.',
  },
  kpiWorkspaces: { es: 'Comercios activos', en: 'Active merchants' },
  kpiWorkspacesNew: { es: 'nuevos en el período', en: 'new in the period' },
  kpiUsers: { es: 'Usuarios', en: 'Users' },
  kpiContacts: { es: 'Contactos', en: 'Contacts' },
  kpiConversations: { es: 'Conversaciones', en: 'Conversations' },
  kpiMessagesIn: { es: 'Mensajes recibidos', en: 'Messages received' },
  kpiMessagesOut: { es: 'Mensajes enviados', en: 'Messages sent' },
  kpiMessagesFailed: { es: 'Envíos fallidos', en: 'Failed sends' },
  kpiAiSent: { es: 'Respuestas de IA', en: 'AI replies' },
  kpiAiCost: { es: 'Costo de IA', en: 'AI cost' },
  kpiCalls: { es: 'Llamadas', en: 'Calls' },
  kpiCallMinutes: { es: 'Minutos de voz', en: 'Voice minutes' },
  kpiCallCost: { es: 'Costo de voz', en: 'Voice cost' },
  kpiOrders: { es: 'Pedidos', en: 'Orders' },
  alertsTitle: { es: 'Requiere atención', en: 'Needs attention' },
  alertConnections: {
    es: 'conexiones de canal caídas',
    en: 'channel connections down',
  },
  alertWebhooks: {
    es: 'webhooks sin procesar',
    en: 'unprocessed webhooks',
  },
  alertCrons: { es: 'trabajos con error', en: 'jobs with errors' },
  allClear: { es: 'Todo en orden', en: 'All clear' },
  chartActivity: { es: 'Actividad diaria', en: 'Daily activity' },

  // ── Comercios ──
  workspacesTitle: { es: 'Comercios', en: 'Merchants' },
  workspacesSearch: {
    es: 'Nombre o correo del dueño',
    en: 'Name or owner email',
  },
  colOwner: { es: 'Dueño', en: 'Owner' },
  colMembers: { es: 'Equipo', en: 'Team' },
  colChannels: { es: 'Canales', en: 'Channels' },
  colContacts: { es: 'Contactos', en: 'Contacts' },
  colAgents: { es: 'Agentes', en: 'Agents' },
  colLastActivity: { es: 'Última actividad', en: 'Last activity' },
  colCreated: { es: 'Alta', en: 'Created' },
  deletedBadge: { es: 'Eliminado', en: 'Deleted' },
  workspaceDetailTitle: { es: 'Ficha del comercio', en: 'Merchant detail' },
  notFound: { es: 'No existe', en: 'Not found' },
  members: { es: 'Equipo', en: 'Team' },
  connections: { es: 'Conexiones', en: 'Connections' },

  // Lo que el comercio contestó sobre las ventas que cierra hablando y carga a
  // mano: las que Riverz causa y no puede probar (migración 229).
  ventasAManoTitle: {
    es: 'Cierra ventas hablando',
    en: 'Closes sales over chat',
  },
  ventasAManoSeguido: {
    es: 'Casi todos los días. Hay venta nuestra que no lleva marca.',
    en: 'Most days. There are sales of ours carrying no stamp.',
  },
  ventasAManoAVeces: {
    es: 'A veces. Parte de la venta no lleva marca.',
    en: 'Sometimes. Some sales carry no stamp.',
  },
  ventasAManoCasiNunca: {
    es: 'Casi nunca. El cliente compra solo en la tienda.',
    en: 'Almost never. Customers buy on the store by themselves.',
  },
  agents: { es: 'Agentes de IA', en: 'AI agents' },
  counts: { es: 'Volumen', en: 'Volume' },
  countFlows: { es: 'Flujos', en: 'Flows' },
  countAutomations: { es: 'Automatizaciones', en: 'Automations' },
  countBroadcasts: { es: 'Campañas', en: 'Campaigns' },
  countProducts: { es: 'Productos', en: 'Products' },
  recentErrors: { es: 'Errores recientes', en: 'Recent errors' },
  roleAdmin: { es: 'Administrador', en: 'Admin' },
  roleAgent: { es: 'Usuario', en: 'User' },
  sectionsAll: { es: 'Acceso total', en: 'Full access' },
  sectionsLimited: { es: '{n} secciones', en: '{n} sections' },
  lastError: { es: 'Último error', en: 'Last error' },
  lastSync: { es: 'Última sincronización', en: 'Last sync' },
  qualityRating: { es: 'Calidad', en: 'Quality' },
  tier: { es: 'Límite de envío', en: 'Send tier' },
  agentActive: { es: 'Activo', en: 'Active' },
  agentPaused: { es: 'Pausado', en: 'Paused' },

  // ── Usuarios ──
  usersTitle: { es: 'Usuarios', en: 'Users' },
  usersSearch: { es: 'Nombre o correo', en: 'Name or email' },
  colEmail: { es: 'Correo', en: 'Email' },
  colName: { es: 'Nombre', en: 'Name' },
  colWorkspaces: { es: 'Comercios', en: 'Merchants' },
  colLocale: { es: 'Idioma', en: 'Language' },
  colTerms: { es: 'Términos', en: 'Terms' },
  platformAdminBadge: { es: 'Equipo Riverz', en: 'Riverz team' },
  ownerBadge: { es: 'Dueño', en: 'Owner' },

  // ── Registros ──
  logsTitle: { es: 'Registros', en: 'Logs' },
  logKindAi: { es: 'IA', en: 'AI' },
  logKindAutomations: { es: 'Automatizaciones', en: 'Automations' },
  logKindFlows: { es: 'Flujos', en: 'Flows' },
  logKindMessages: { es: 'Envíos fallidos', en: 'Failed sends' },
  logKindTemplates: { es: 'Plantillas', en: 'Templates' },
  logKindBroadcasts: { es: 'Campañas', en: 'Campaigns' },
  logKindWebhooks: { es: 'Webhooks', en: 'Webhooks' },
  logKindConnections: { es: 'Conexiones', en: 'Connections' },
  logKindCrons: { es: 'Trabajos', en: 'Jobs' },
  logKindApprovals: { es: 'Aprobaciones', en: 'Approvals' },
  logKindCommentToDm: { es: 'Comentarios a DM', en: 'Comment to DM' },
  logKindIgProactive: { es: 'IG proactivo', en: 'Proactive IG' },
  logKindVoice: { es: 'Voz', en: 'Voice' },
  logsAiHint: {
    es: 'Cuando la IA no contesta, el motivo queda aquí.',
    en: "When the AI doesn't reply, the reason lands here.",
  },
  colWhen: { es: 'Cuándo', en: 'When' },
  colStatus: { es: 'Estado', en: 'Status' },
  colDetail: { es: 'Detalle', en: 'Detail' },

  // ── Operación ──
  opsTitle: { es: 'Operación', en: 'Operations' },
  opsCrons: { es: 'Trabajos programados', en: 'Scheduled jobs' },
  opsWebhooks: { es: 'Cola de webhooks', en: 'Webhook queue' },
  colJob: { es: 'Trabajo', en: 'Job' },
  colSchedule: { es: 'Frecuencia', en: 'Schedule' },
  colLastRun: { es: 'Última corrida', en: 'Last run' },
  colDuration: { es: 'Duración', en: 'Duration' },
  colRuns24h: { es: '24 h', en: '24 h' },
  cronStale: { es: 'Sin reportar', en: 'Not reporting' },
  webhooksUnprocessed: { es: 'sin procesar', en: 'unprocessed' },

  // El reloj interno. Sin él, todos los demás números son de antes.
  schedulerBeat: { es: 'Reloj interno', en: 'Internal clock' },
  schedulerAlive: { es: 'Latiendo', en: 'Beating' },
  schedulerDead: { es: 'Detenido', en: 'Stopped' },
  schedulerRunning: { es: 'Corriendo ahora', en: 'Running now' },
  schedulerDeadNote: {
    es: 'Ningún trabajo de fondo se está disparando: ni campañas, ni carritos, ni seguimientos.',
    en: 'No background job is firing: no campaigns, no cart recovery, no follow-ups.',
  },

  // Qué hace cada trabajo, en una línea.
  cronFlowsResume: {
    es: 'Reanuda flujos en espera',
    en: 'Resumes waiting flows',
  },
  cronAutomations: {
    es: 'Drena pasos de espera de automatizaciones',
    en: 'Drains automation wait steps',
  },
  cronFlowsRetries: {
    es: 'Reintenta ejecuciones de flujo fallidas',
    en: 'Retries failed flow runs',
  },
  cronBroadcasts: {
    es: 'Envía campañas programadas',
    en: 'Sends scheduled campaigns',
  },
  cronVoiceCalls: {
    es: 'Despacha llamadas en cola',
    en: 'Dispatches queued calls',
  },
  // No es un cron: es el worker de voz avisando que sigue vivo. Sin fila acá,
  // que estuviera apagado no se veía en ninguna pantalla.
  cronVoiceWorker: {
    es: 'Latido del worker de voz',
    en: 'Voice worker heartbeat',
  },
  cronVoiceCampaignRun: {
    es: 'Avanza campañas de voz',
    en: 'Advances voice campaigns',
  },
  cronInstagramAgent: {
    es: 'Motor de DMs proactivos de Instagram',
    en: 'Instagram proactive DM engine',
  },
  cronOutlookPoll: {
    es: 'Sondea buzones de Outlook',
    en: 'Polls Outlook mailboxes',
  },
  cronZohoPoll: {
    es: 'Sondea buzones de Zoho Mail',
    en: 'Polls Zoho Mail mailboxes',
  },
  cronGmailPoll: { es: 'Sondea buzones de Gmail', en: 'Polls Gmail mailboxes' },
  cronMercadolibre: {
    es: 'Preguntas, pedidos, envíos, reclamos y catálogo de Mercado Libre',
    en: 'Mercado Libre questions, orders, shipping, claims and catalog',
  },
  cronCommentSync: {
    es: 'Sincroniza comentarios de Facebook e Instagram',
    en: 'Syncs Facebook and Instagram comments',
  },
  cronCommentReconcile: {
    es: 'Reconcilia comentarios borrados u ocultados',
    en: 'Reconciles deleted or hidden comments',
  },
  cronContactsSync: {
    es: 'Completa datos de contactos desde la tienda',
    en: 'Fills in contact data from the store',
  },
  cronTiktokComments: {
    es: 'Trae los comentarios nuevos de TikTok',
    en: 'Brings in new TikTok comments',
  },
  cronSelfHeal: {
    es: 'Recupera colas y suscripciones detenidas',
    en: 'Recovers stalled queues and subscriptions',
  },
  cronTiktokWebhook: {
    es: 'Registra en TikTok a dónde avisar los comentarios',
    en: 'Tells TikTok where to send comment events',
  },
  cronTiktokDeep: {
    es: 'Repasa todos los videos de TikTok, no solo los nuevos',
    en: 'Sweeps every TikTok video, not just the newest',
  },
  cronTiktokTranscripciones: {
    es: 'Transcribe los videos de TikTok para contestar sus comentarios',
    en: 'Transcribes TikTok videos so their comments can be answered',
  },
  cronInstagramEnrich: {
    es: 'Enriquece perfiles públicos de Instagram',
    en: 'Enriches public Instagram profiles',
  },
  cronFlowsSweep: {
    es: 'Barre flujos vencidos por tiempo',
    en: 'Sweeps timed-out flows',
  },
  cronKlaviyoSync: {
    es: 'Espeja los contactos hacia Klaviyo',
    en: 'Mirrors contacts to Klaviyo',
  },
  cronAiFollowups: {
    es: 'Seguimientos de la IA cuando el cliente calla',
    en: 'AI follow-ups when the customer goes quiet',
  },
  cronMercadopagoSync: {
    es: 'Trae los pagos rechazados de Mercado Pago',
    en: 'Pulls rejected Mercado Pago payments',
  },
  cronDeliveryWatchdog: {
    es: 'Marca envíos sin confirmar',
    en: 'Flags unconfirmed deliveries',
  },
  cronConversionRetry: {
    es: 'Reintenta las ventas que no le llegaron a Meta',
    en: "Retries sales that didn't reach Meta",
  },
  cronAdsSync: {
    es: 'Marca qué comentarios vienen de un anuncio',
    en: 'Flags which comments came from an ad',
  },
  cronShopifyCartRecovery: {
    es: 'Recupera carritos abandonados',
    en: 'Recovers abandoned carts',
  },
  cronTiendanubeCheckouts: {
    es: 'Descubre carritos abandonados de Tiendanube',
    en: 'Finds abandoned Tiendanube carts',
  },
  cronMercadopagoRecovery: {
    es: 'Recupera pagos rechazados de Mercado Pago',
    en: 'Recovers rejected Mercado Pago payments',
  },
  cronShopifyFeedback: {
    es: 'Pide opinión tras la entrega',
    en: 'Asks for feedback after delivery',
  },
  cronMetaContactNames: {
    es: 'Completa nombres de contactos de Meta',
    en: 'Fills in Meta contact names',
  },
  cronMetaWebhookSubs: {
    es: 'Reaplica suscripciones de webhooks de Meta',
    en: 'Re-applies Meta webhook subscriptions',
  },
  cronCommerceWebhooks: {
    es: 'Repunta los webhooks de las tiendas al dominio actual',
    en: 'Repoints store webhooks at the current domain',
  },
  cronGmailWatch: {
    es: 'Renueva la suscripción push de Gmail',
    en: 'Renews the Gmail push subscription',
  },
  cronCatalogEnrich: {
    es: 'Le lee la página a los productos nuevos y une los repetidos entre plataformas',
    en: "Reads new products' pages and merges the ones duplicated across platforms",
  },
  cronOutlookWatch: {
    es: 'Renueva la suscripción push de Outlook',
    en: 'Renews the Outlook push subscription',
  },
  cronMetaDmBackfill: {
    es: 'Reingesta historial de mensajes de Meta',
    en: 'Re-ingests Meta message history',
  },
  cronPiiPurge: {
    es: 'Borra datos personales de comercios eliminados',
    en: 'Deletes personal data from removed accounts',
  },
  // Las conversaciones de toda la plataforma, sin una palabra de lo que dicen.
  sectionConversations: { es: 'Conversaciones', en: 'Conversations' },
  sectionConversationsDesc: {
    es: 'Todas las conversaciones de cada comercio, sin leer lo que dicen.',
    en: "Every account's conversations, without reading what they say.",
  },
  convState: { es: 'Estado', en: 'Status' },
  convStatus_open: { es: 'abierta', en: 'open' },
  convStatus_resolved: { es: 'resuelta', en: 'resolved' },
  convStatus_closed: { es: 'cerrada', en: 'closed' },
  convStatus_pending: { es: 'pendiente', en: 'pending' },
  convNeedsHuman: { es: 'pide una persona', en: 'needs a human' },
  convAi: { es: 'IA', en: 'AI' },
  convAiOn: { es: 'prendida', en: 'on' },
  convAiOff: { es: 'apagada', en: 'off' },
  convMessages: { es: 'Mensajes', en: 'Messages' },
  convLast: { es: 'Último', en: 'Last' },
  convAllChannels: { es: 'Todos los canales', en: 'All channels' },
  convWorkspaceId: { es: 'Id del comercio', en: 'Account id' },
  convOpen: { es: 'Ver', en: 'Open' },
  convNoPermission: {
    es: 'Este comercio no autorizó que soporte lea sus conversaciones. Puede abrirlo desde Ajustes.',
    en: 'This account has not authorized support to read its conversations. They can open it in Settings.',
  },
  convGrantedUntil: {
    es: 'Permiso hasta el {fecha}',
    en: 'Access until {fecha}',
  },
  convPrivacy: {
    es: 'Metadatos, no contenido: los mensajes y los datos del comprador no salen de la cuenta.',
    en: 'Metadata, not content: message bodies and buyer details never leave the account.',
  },

  // El negocio: MRR, costo y qué paga cada comercio.
  sectionBusiness: { es: 'Negocio', en: 'Business' },
  sectionBusinessDesc: {
    es: 'Cuánto entra, qué consume cada comercio y qué se le cobra.',
    en: 'What comes in, what each merchant consumes and what they are charged.',
  },
  billingMrr: { es: 'MRR', en: 'MRR' },
  billingArr: { es: 'ARR', en: 'ARR' },
  billingCost: { es: 'Costo de IA', en: 'AI cost' },
  billingMargin: { es: '{n}% de margen', en: '{n}% margin' },
  billingNoMargin: { es: 'Todavía no entra plata', en: 'No revenue yet' },
  billingArpu: { es: 'Por cliente', en: 'Per customer' },
  billingPaying: { es: '{n} pagando', en: '{n} paying' },
  // ── Billetera ──
  walletBalance: { es: 'Saldo', en: 'Balance' },
  walletOff: { es: 'IA apagada', en: 'AI off' },
  walletLoaded: { es: 'Saldo cargado', en: 'Balance loaded' },
  walletLoadedHint: {
    es: 'Recargas del período, aparte del MRR',
    en: 'Top-ups in the period, on top of MRR',
  },
  walletSpent: { es: 'Saldo consumido', en: 'Balance used' },
  walletFloat: { es: 'Saldo sin usar', en: 'Unused balance' },
  walletFloatHint: {
    es: 'Cobrado y todavía no prestado',
    en: 'Collected, not yet delivered',
  },
  walletBlockToggle: {
    es: 'Sin saldo se apaga la IA',
    en: 'No balance turns the AI off',
  },
  walletAtCost: {
    es: 'Cobrarle a costo (sin margen)',
    en: 'Charge at cost (no margin)',
  },
  walletGrant: { es: 'Cargar', en: 'Load' },
  walletGrantAmount: {
    es: 'Saldo a cargar (US$)',
    en: 'Balance to load (US$)',
  },
  walletGrantWhy: { es: 'Por qué', en: 'Why' },
  cronWalletAutorecarga: {
    es: 'Recarga la billetera de quien bajó del umbral y tiene tarjeta',
    en: 'Tops up wallets that fell below their threshold and have a card',
  },
  // ── Saldos de proveedores ──
  // Proveedores — la fusión de las viejas Saldos e Infraestructura.
  sectionProviders: { es: 'Proveedores', en: 'Providers' },
  sectionProvidersDesc: {
    es: 'Cuánto le queda a cada API, si está en pie y con qué llave se le habla.',
    en: "What each API has left, whether it's up, and which key talks to it.",
  },
  // La pestaña que cuesta plata: son sondas facturables. La otra es gratis.
  providersTabBalance: { es: 'Saldo y estado', en: 'Balance & status' },
  // La IA que escribe y la que habla.
  featureExceptions: {
    es: '{n} con excepción',
    en: '{n} with an exception',
  },
  cashTabToday: { es: 'Hoy', en: 'Today' },
  cashTabFixed: { es: 'Fijo del mes', en: 'Monthly fixed' },
  businessTabPrices: { es: 'Planes y tarifas', en: 'Plans & rates' },
  aiTabText: { es: 'Texto', en: 'Text' },
  aiTabVoice: { es: 'Voz', en: 'Voice' },
  aiKeyManageThere: {
    es: 'Se carga en Proveedores → Llaves',
    en: 'Managed in Providers → Keys',
  },
  providersMoneyBlock: {
    es: '¿Me alcanza para hoy?',
    en: 'Is there enough for today?',
  },
  providersUpBlock: {
    es: '¿Está todo funcionando?',
    en: 'Is everything up?',
  },
  providersMonthBlock: {
    es: '¿Cuánto sale el mes?',
    en: 'What does the month cost?',
  },
  providersChecked: { es: 'Consultado', en: 'Checked' },
  providersChars: { es: '{n} caracteres', en: '{n} characters' },
  // Detalles nuevos de esta pantalla.
  svcIncome: {
    es: 'Lo que entra: suscripciones y recargas',
    en: 'What comes in: subscriptions and top-ups',
  },
  svcIncomePending: {
    es: 'Suscripciones y recargas · +{v} en camino',
    en: 'Subscriptions and top-ups · +{v} on the way',
  },
  svcNoBalanceApi: {
    es: 'No publica saldo por API, hay que mirar su tablero',
    en: 'No balance over the API, check its dashboard',
  },
  svcEmailSendOnly: {
    es: 'Lista de espera y avisos · la llave sólo puede enviar',
    en: 'Waitlist and alerts · the key can only send',
  },
  // Lo que Riverz le consumió al proveedor en el mes. Va donde los modelos no
  // publican saldo: un guion no dice si se queman diez dólares o mil.
  //
  // Sin los tokens: el desglose por modelo (migración 230) guarda el costo, no
  // el conteo, y un token de Opus no vale lo mismo que uno de Haiku — la cifra
  // que decide cuánto recargar es la de plata. Los tokens siguen por comercio
  // en la pestaña de uso.
  providersSpent: {
    es: '{usd} este mes',
    en: '{usd} this month',
  },
  // Administrar las llaves globales: las que Riverz pone y con las que
  // trabajan todos los comercios.
  sectionKeys: { es: 'Llaves', en: 'Keys' },
  sectionKeysDesc: {
    es: 'Las llaves de IA y voz con las que trabajan todos los comercios.',
    en: 'The AI and voice keys every merchant works with.',
  },
  keysBlock: { es: 'Una por proveedor', en: 'One per provider' },
  keysMissing: { es: 'Sin llave', en: 'Missing' },
  keysMissingHint: {
    es: 'Hay tarifas que hoy no se pueden cobrar',
    en: "Some rates can't be billed today",
  },
  keysAllSet: { es: 'Todas cargadas', en: 'All set' },
  keysFromPanel: { es: 'Desde el panel', en: 'From the panel' },
  keysFromPanelHint: {
    es: 'El resto sale de Render y cambiarla pide un deploy',
    en: 'The rest come from Render and changing one needs a deploy',
  },
  keysProviders: { es: 'Proveedores', en: 'Providers' },
  // Etiqueta corta para la pastilla. `keyOrigin_*` se interpola dentro de una
  // frase ("La que esta activa sale de Render") y suelta se lee raro.
  keyState_panel: { es: 'En el panel', en: 'In the panel' },
  keyState_render: { es: 'En Render', en: 'In Render' },
  keyState_falta: { es: 'Falta', en: 'Missing' },
  keyEdit: { es: 'Cambiar llave', en: 'Change key' },
  keyMissing: { es: 'Sin llave', en: 'No key' },
  keySave: { es: 'Guardar', en: 'Save' },
  keyRemove: { es: 'Quitar del panel', en: 'Remove from panel' },
  keySaved: { es: 'Llave guardada', en: 'Key saved' },
  keyRemoved: {
    es: 'Quitada. Vuelve a la de Render.',
    en: "Removed. Falls back to Render's.",
  },
  keyError: { es: 'No se pudo guardar', en: "Couldn't save" },
  keyPlaceholder: { es: 'Pegar la llave nueva', en: 'Paste the new key' },
  keyOrigin: {
    es: 'La que está activa sale {v}',
    en: 'The active one comes {v}',
  },
  keyOrigin_panel: { es: 'de este panel', en: 'from this panel' },
  keyOrigin_render: { es: 'de Render', en: 'from Render' },
  keyOrigin_falta: { es: 'de ningún lado: falta', en: 'from nowhere: missing' },
  keyBilling: {
    es: 'Sin ella no se puede cobrar',
    en: "Without it you can't bill",
  },
  // Los conceptos de la billetera que dependen de cada llave.
  billingPayLink: { es: 'Link de pago', en: 'Payment link' },
  billingCoupon: { es: 'Descuento', en: 'Discount' },
  billingNoCoupon: { es: 'Sin descuento', en: 'No discount' },
  billingCopy: { es: 'Copiar', en: 'Copy' },
  billingCopied: { es: 'Copiado', en: 'Copied' },

  concepto_ia_respuesta: { es: 'Respuestas de la IA', en: 'AI replies' },
  concepto_ia_operador: { es: 'El Operador', en: 'The Operator' },
  concepto_llamada_voz: { es: 'Llamadas', en: 'Calls' },
  concepto_voz_tts: { es: 'Voz', en: 'Voice' },
  concepto_voz_stt: { es: 'Transcripción', en: 'Transcription' },
  concepto_busqueda_web: { es: 'Búsqueda web', en: 'Web search' },
  concepto_imagen: { es: 'Imágenes', en: 'Images' },
  concepto_investigacion: { es: 'Investigación', en: 'Research' },
  concepto_ia_seguimiento: { es: 'Seguimientos', en: 'Follow-ups' },
  concepto_ia_resumen: {
    es: 'Memoria de conversaciones',
    en: 'Conversation memory',
  },
  concepto_ia_clasificacion: { es: 'Clasificación', en: 'Classification' },
  concepto_entender_publicacion: {
    es: 'Entender una publicación',
    en: 'Understanding a post',
  },
  // Costos fijos
  fixedMissingEnv: { es: 'Falta {v}', en: 'Missing {v}' },
  fixedNoAnswer: { es: 'No respondió', en: 'No answer' },
  fixedNoAnswerHttp: {
    es: 'No respondió (HTTP {v})',
    en: 'No answer (HTTP {v})',
  },
  fixedRenderPlan: { es: 'Render · {v}', en: 'Render · {v}' },
  fixedRenderPlanDisk: { es: 'Render · {v} de disco', en: 'Render · {v} disk' },
  fixedRenderSuspended: {
    es: 'Render · {v} · suspendido',
    en: 'Render · {v} · suspended',
  },
  fixedSupabase: {
    es: 'La base de datos de todos los comercios',
    en: 'The database behind every merchant',
  },
  fixedSupabasePlan: {
    es: 'La base de datos de todos los comercios · plan {v}',
    en: 'The database behind every merchant · {v} plan',
  },
  // El plan de Supabase es de la cuenta entera y ya viene con el crédito de
  // compute descontado: sin decirlo, el número no coincide con la factura.
  fixedSupabasePlanNet: {
    es: 'Plan {v} de la cuenta, menos el crédito de compute',
    en: 'Account {v} plan, minus the compute credit',
  },
  fixedSupabaseCompute: {
    es: 'Supabase · instancia {v}',
    en: 'Supabase · {v} instance',
  },
  // Los dos grupos que no son un repo ni una base con nombre propio.
  fixedProjectCrm: { es: 'Riverz CRM', en: 'Riverz CRM' },
  fixedProjectShared: {
    es: 'De la cuenta, sin repartir',
    en: 'Account-wide, unallocated',
  },
  fixedCrmMonthly: { es: 'El CRM al mes', en: 'The CRM per month' },
  fixedCrmMonthlyHint: {
    es: 'Sólo el producto que se vende',
    en: 'Only the product being sold',
  },
  fixedOthersMonthly: { es: 'Otros proyectos', en: 'Other projects' },
  fixedPhoneNumbers: {
    es: '{v} números alquilados · cada cuenta compra el suyo',
    en: '{v} rented numbers · each account buys its own',
  },
  fixedDomains: {
    es: 'Se pagan por año',
    en: 'Billed yearly',
  },
  fixedWhatsapp: {
    es: 'Por mensaje de plantilla; la atención dentro de 24 h no cuesta',
    en: 'Per template message; replies inside 24 h are free',
  },

  sectionBalances: { es: 'Saldos', en: 'Balances' },
  sectionBalancesDesc: {
    es: 'Cuánto le queda a cada proveedor que hay que recargar',
    en: 'How much is left with each provider you have to top up',
  },
  balancesAllGood: {
    es: 'Nada por recargar',
    en: 'Nothing to top up',
  },
  balancesNeedTopUp: {
    es: '{n} para recargar',
    en: '{n} to top up',
  },
  balancesTopUp: { es: 'Recargar', en: 'Top up' },
  balancesOpen: { es: 'Ver', en: 'Open' },
  balancesRechargeable: {
    es: 'Saldo que se recarga',
    en: 'Balance you top up',
  },
  balancesNoApi: {
    es: 'No publican saldo por API',
    en: 'No balance available by API',
  },
  balancesToTopUp: { es: 'Para recargar', en: 'To top up' },
  balancesProviders: { es: 'Servicios conectados', en: 'Connected services' },
  fixedMonthly: { es: 'Total del mes', en: 'Total per month' },
  fixedUnmeasured: {
    es: '{n} sin medir: es un piso, no el total',
    en: '{n} not measured: this is a floor, not the total',
  },
  fixedFree: { es: 'Sin costo', en: 'Free' },
  perMonth: { es: '/mes', en: '/mo' },
  balanceState_ok: { es: 'Con saldo', en: 'Funded' },
  balanceState_bajo: { es: 'Bajo', en: 'Low' },
  balanceState_sin_saldo: { es: 'Sin saldo', en: 'Empty' },
  balanceState_desconocido: { es: 'No lo dice', en: 'Not exposed' },
  balanceState_sin_llave: { es: 'Sin llave', en: 'No key' },
  balanceState_error: { es: 'No respondió', en: 'No answer' },
  walletRates: { es: 'Cuánto sale cada cosa', en: 'What each thing costs' },
  walletMovements: { es: 'Movimientos', en: 'Movements' },
  walletNoMovements: { es: 'Sin movimientos', en: 'No movements' },
  billingCustomers: { es: 'Clientes', en: 'Customers' },
  billingPlans: { es: 'Planes', en: 'Plans' },
  billingAccounts: { es: 'Cuentas', en: 'Accounts' },
  billingState: { es: 'Estado', en: 'Status' },
  billingState_prueba: { es: 'en prueba', en: 'trialing' },
  billingState_activa: { es: 'paga', en: 'paying' },
  billingState_cortesia: { es: 'cortesía', en: 'comped' },
  billingState_vencida: { es: 'vencida', en: 'past due' },
  billingState_cancelada: { es: 'cancelada', en: 'canceled' },
  billingUsage: { es: 'Conversaciones', en: 'Conversations' },
  billingOwnDeal: { es: 'trato propio', en: 'custom deal' },
  billingEdit: { es: 'Cambiar', en: 'Change' },
  billingSave: { es: 'Guardar', en: 'Save' },
  billingCreate: { es: 'Crear', en: 'Create' },
  billingCancel: { es: 'Cancelar', en: 'Cancel' },
  billingKeep: { es: 'Sin cambios', en: 'Unchanged' },
  billingSlug: { es: 'Clave', en: 'Key' },
  billingName: { es: 'Nombre', en: 'Name' },
  billingPrice: { es: 'Precio / mes', en: 'Price / mo' },
  billingIncluded: { es: 'Incluidas', en: 'Included' },
  billingOverage: { es: 'Excedente c/u', en: 'Overage ea.' },
  billingStripePrice: { es: 'Price de Stripe', en: 'Stripe price' },
  billingOwnPrice: { es: 'Precio propio', en: 'Custom price' },
  billingOwnIncluded: { es: 'Incluidas propias', en: 'Custom included' },
  billingNote: { es: 'Por qué', en: 'Why' },
  billingNew: { es: 'Dar de alta', en: 'Add account' },
  billingNewHint: {
    es: 'Se invita por correo y la cuenta nace con el trato que elijas.',
    en: 'Invited by email; the account starts on the deal you pick.',
  },
  billingEmail: { es: 'Correo', en: 'Email' },
  billingInvite: { es: 'Invitar', en: 'Invite' },

  cronBillingUsage: {
    es: 'Acumula el consumo de cada cuenta para facturar',
    en: "Rolls up each account's usage for billing",
  },
  cronIssuesAlert: {
    es: 'Avisa al comercio lo que se rompió en silencio',
    en: 'Emails each account what broke silently',
  },
  cronMetaTokenRefresh: {
    es: 'Renueva el token de Facebook Login',
    en: 'Renews the Facebook Login token',
  },
  cronShopifyTokenRefresh: {
    es: 'Renueva el acceso a Shopify antes de que venza',
    en: 'Renews Shopify access before it expires',
  },
  cronReengagement: {
    es: 'Reengancha compradores inactivos',
    en: 'Re-engages dormant buyers',
  },
  cronMlOrders: {
    es: 'Pedidos y envíos de Mercado Libre',
    en: 'Mercado Libre orders and shipping',
  },
  cronMlClaims: {
    es: 'Reclamos de Mercado Libre',
    en: 'Mercado Libre claims',
  },
  cronMlCatalog: {
    es: 'Precio y stock de Mercado Libre',
    en: 'Mercado Libre price and stock',
  },
  cronMlReviews: {
    es: 'Opiniones de Mercado Libre',
    en: 'Mercado Libre reviews',
  },
  cronPlatformWatch: {
    es: 'Avisa al equipo lo que se acaba de romper',
    en: 'Alerts the team about anything that just broke',
  },
  colProvider: { es: 'Origen', en: 'Source' },
  colAttempts: { es: 'Intentos', en: 'Attempts' },

  // ── Uso y costos ──
  usageTitle: { es: 'Uso y costos', en: 'Usage & cost' },
  usageDesc: {
    es: 'Costo estimado con precios de lista, sin descuentos por caché.',
    en: 'Estimated at list prices, without cache discounts.',
  },
  colMessagesOut: { es: 'Enviados', en: 'Sent' },
  colAiSent: { es: 'Respuestas IA', en: 'AI replies' },
  colTokens: { es: 'Tokens', en: 'Tokens' },
  colAiCost: { es: 'Costo IA', en: 'AI cost' },
  colCalls: { es: 'Llamadas', en: 'Calls' },
  colMinutes: { es: 'Minutos', en: 'Minutes' },
  colVoiceCost: { es: 'Costo voz', en: 'Voice cost' },
  colOrders: { es: 'Pedidos', en: 'Orders' },
  totals: { es: 'Total', en: 'Total' },

  // ── Canales ──
  colChannel: { es: 'Canal', en: 'Channel' },
  colAccount: { es: 'Cuenta', en: 'Account' },
  statusConnected: { es: 'Conectado', en: 'Connected' },
  statusDisconnected: { es: 'Desconectado', en: 'Disconnected' },
  statusError: { es: 'Con error', en: 'Error' },
  statusPending: { es: 'Pendiente', en: 'Pending' },
  statusExpired: { es: 'Vencido', en: 'Expired' },
  // Las tiendas (`shopify_connections`) no usan los mismos estados que los
  // canales de mensajería: su CHECK admite active/uninstalled/expired/error.
  // Sin estas dos, la tabla imprimía la clave cruda — `admin.statusActive` —
  // en cada fila de Shopify y Tiendanube.
  statusActive: { es: 'Conectada', en: 'Connected' },
  statusUninstalled: { es: 'Desinstalada', en: 'Uninstalled' },

  // ── Auditoría ──
  auditTitle: { es: 'Auditoría', en: 'Audit' },
  auditDesc: {
    es: 'Cada pantalla que el equipo abre queda registrada.',
    en: 'Every screen the team opens is recorded.',
  },
  colActor: { es: 'Quién', en: 'Who' },
  colWorkspace: { es: 'Comercio', en: 'Merchant' },
  // Detalle de cada servicio en /admin/infra. Van como clave y no como texto:
  // el módulo que las produce corre en el servidor y no sabe en qué idioma se
  // está mirando el panel.
  svcNoData: { es: 'sin datos', en: 'no data' },
  svcNoAnswer: { es: 'no responde', en: 'not responding' },
  svcNoProject: { es: 'sin proyecto', en: 'no project' },
  svcNoCredit: { es: 'sin saldo', en: 'out of credit' },
  svcRateLimited: { es: 'límite de uso', en: 'rate limited' },
  svcHttpError: { es: 'respondió con error', en: 'responded with an error' },
  svcActive: { es: 'activo', en: 'active' },
  svcOperational: { es: 'operativo', en: 'operational' },
  svcAllUp: { es: 'todos activos', en: 'all up' },
  svcSuspended: {
    es: 'hay servicios suspendidos',
    en: 'some services suspended',
  },
  svcTelephony: { es: 'telefonía', en: 'telephony' },
  svcStt: {
    es: 'transcripción + voz Celeste',
    en: 'transcription + Celeste voice',
  },
  svcTts: { es: 'voz S2.1', en: 'S2.1 voice' },
  svcTtsFree: {
    es: 'voz S2.1 · sólo el modelo gratis',
    en: 'S2.1 voice · free model only',
  },
  svcTtsPremium: {
    es: 'voz premium (no en uso)',
    en: 'premium voice (unused)',
  },
  svcTextBot: { es: 'bot de texto + investigación', en: 'text bot + research' },
  svcCallOrchestration: {
    es: 'orquestación de llamadas',
    en: 'call orchestration',
  },
  svcVoiceLlm: { es: 'LLM de voz (rápido)', en: 'voice LLM (fast)' },
  svcBackupLlm: { es: 'LLM de respaldo', en: 'backup LLM' },
  svcGpt: { es: 'GPT', en: 'GPT' },
  svcEmail: { es: 'lista de espera y avisos', en: 'waitlist and alerts' },
  svcPlatformWa: {
    es: 'por aquí salen las preguntas al comercio',
    en: 'this is how we ask the merchant',
  },

  // Pantalla de desbloqueo. Es lo primero que se ve en admin.riverz.co, y era
  // una de las dos que no pasaban por i18n.
  unlockTitle: { es: 'Panel de plataforma', en: 'Platform panel' },
  unlockPlaceholder: { es: 'Contraseña del panel', en: 'Panel password' },
  unlockSubmit: { es: 'Entrar', en: 'Enter' },
  unlockFailed: { es: 'No se pudo abrir', en: "Couldn't unlock" },
  unlockNetwork: { es: 'Error de red', en: 'Network error' },
  unlockNotConfigured: {
    es: 'Falta definir ADMIN_PANEL_PASSWORD en el servidor. Sin esa contraseña el panel no se abre para nadie.',
    en: "ADMIN_PANEL_PASSWORD isn't set on the server. Without it the panel opens for nobody.",
  },

  // WhatsApp de la plataforma. Era la otra pantalla que no pasaba por i18n.
  waPlatformTitle: { es: 'WhatsApp de Riverz', en: 'Riverz WhatsApp' },
  waPlatformDesc: {
    es: 'El número con el que la plataforma le avisa a los comercios cuando algo se rompe. Va aparte del de cada cuenta a propósito.',
    en: 'The number the platform uses to tell merchants something broke. Separate from their own on purpose.',
  },
  waNeedsMigration: {
    es: 'Falta aplicar la migración 147_platform_whatsapp.sql. Hasta entonces sólo se puede configurar por variables de entorno.',
    en: "Migration 147_platform_whatsapp.sql hasn't been applied. Until then it can only be set through environment variables.",
  },
  waConnectTitle: { es: 'Conectar con Meta', en: 'Connect with Meta' },
  waConnectHint: {
    es: 'Abre el registro de WhatsApp Business de Meta y trae el número y el token sin copiar nada.',
    en: "Opens Meta's WhatsApp Business signup and brings the number and token over without copying anything.",
  },
  waReconnectNote: {
    es: 'Volver a conectarlo reemplaza el token guardado.',
    en: 'Reconnecting replaces the saved token.',
  },
  waConnect: {
    es: 'Conectar WhatsApp de Riverz',
    en: 'Connect Riverz WhatsApp',
  },
  waReconnect: { es: 'Volver a conectar', en: 'Reconnect' },
  waManual: { es: 'Cargar los datos a mano', en: 'Enter the details by hand' },
  waPhoneId: {
    es: 'ID del número (phone_number_id)',
    en: 'Number ID (phone_number_id)',
  },
  waPhoneIdHint: {
    es: 'Meta → WhatsApp → API Setup',
    en: 'Meta → WhatsApp → API Setup',
  },
  waWabaId: {
    es: 'ID de la cuenta de WhatsApp Business (WABA)',
    en: 'WhatsApp Business Account ID (WABA)',
  },
  waDisplay: { es: 'Número, como se muestra', en: 'Number, as displayed' },
  waToken: { es: 'Token permanente', en: 'Permanent token' },
  waTokenSaved: {
    es: 'Ya hay uno guardado: escribe otro sólo si lo cambias',
    en: 'One is already saved: type a new one only to replace it',
  },
  waTokenHint: { es: 'Token del System User', en: 'System User token' },
  waTemplate: { es: 'Plantilla de aviso', en: 'Alert template' },
  waTemplateHint: {
    es: 'Utility aprobada. Las Marketing las retiene Meta.',
    en: 'An approved Utility template. Meta holds back Marketing ones.',
  },
  waNotify: { es: 'Avisar por WhatsApp', en: 'Alert over WhatsApp' },
  waNotifyHint: {
    es: 'Apagado, los avisos siguen saliendo sólo por correo.',
    en: 'Off, alerts still go out by email only.',
  },
  waTechnicalRecipients: {
    es: 'Alertas técnicas',
    en: 'Technical alerts',
  },
  waTechnicalRecipientsHint: {
    es: 'Sólo administración recibe problemas internos. Los comercios reciben sus propios avisos en sus números configurados.',
    en: 'Only administrators receive internal issues. Merchants receive their own alerts at their configured numbers.',
  },
  waTechnicalPhone: {
    es: 'WhatsApp de administración',
    en: 'Administrator WhatsApp',
  },
  waTechnicalEmail: {
    es: 'Correo de administración',
    en: 'Administrator email',
  },
  waTechnicalNeedsMigration: {
    es: 'Falta aplicar la migración 248_destinos_tecnicos_plataforma.sql para guardar estos destinatarios desde el panel. Hasta entonces se usan los valores de Render.',
    en: 'Migration 248_destinos_tecnicos_plataforma.sql must be applied before these recipients can be saved from the panel. Until then, Render values are used.',
  },

  voiceCustom: { es: 'Otro…', en: 'Other…' },
  voiceProviderId: { es: 'id del proveedor', en: 'provider id' },
  voiceModelId: { es: 'id del modelo', en: 'model id' },

  // La puerta MCP: un agente operando sobre las cuentas.
  mcpTitle: { es: 'Operación por agente (MCP)', en: 'Agent access (MCP)' },
  mcpOn: { es: 'Puerta abierta', en: 'Door open' },
  mcpOff: { es: 'Cerrada (sin clave)', en: 'Closed (no key)' },
  mcpCalls: { es: '{n} llamada(s) en 7 días', en: '{n} call(s) in 7 days' },
  mcpFailed: { es: '{n} fallaron', en: '{n} failed' },
  mcpHint: {
    es: 'Todo queda en Auditoría → Agente, lecturas incluidas. Lo irreversible pide confirmación.',
    en: 'Everything lands in Audit → Agent, reads included. Irreversible actions ask first.',
  },

  saveFailed: { es: 'No se pudo guardar', en: "Couldn't save" },

  lockPanel: { es: 'Cerrar el panel', en: 'Lock the panel' },

  // Excepciones de funcionalidad por comercio.
  wsFeaturesTitle: {
    es: 'Funcionalidades de este comercio',
    en: 'Features for this merchant',
  },
  wsFeaturesDesc: {
    es: 'Cada una sigue el valor global salvo que aquí se diga otra cosa.',
    en: 'Each one follows the global value unless overridden here.',
  },
  wsFeatureFollow: { es: 'Global', en: 'Global' },
  wsFeatureOn: { es: 'Prendida', en: 'On' },
  wsFeatureOff: { es: 'Apagada', en: 'Off' },
  wsFeatureGlobalOn: { es: 'Global: prendida', en: 'Global: on' },
  wsFeatureGlobalOff: { es: 'Global: apagada', en: 'Global: off' },

  live: { es: 'En vivo', en: 'Live' },
  liveHint: {
    es: 'Se actualiza solo cada 30 segundos mientras miras esta pestaña.',
    en: 'Refreshes itself every 30 seconds while this tab is open.',
  },
  colHealth: { es: 'Salud', en: 'Health' },
  colCanSend: { es: 'Puede enviar', en: 'Can send' },
  waCanSend: { es: 'Sí', en: 'Yes' },
  waLimited: { es: 'Limitado', en: 'Limited' },
  waBlocked: { es: 'Bloqueado', en: 'Blocked' },
  healthOk: { es: 'Sin problemas', en: 'All good' },
  healthIssues: { es: '{n} problema(s)', en: '{n} issue(s)' },
  alertWorkspacesBroken: {
    es: 'comercios con algo roto ahora mismo',
    en: 'merchants with something broken right now',
  },
  colTool: { es: 'Herramienta', en: 'Tool' },
  colRisk: { es: 'Riesgo', en: 'Risk' },
  colSummary: { es: 'Qué pasó', en: 'What happened' },
  filterActor: { es: 'Filtrar por quién', en: 'Filter by who' },
  filterWorkspace: { es: 'Id de comercio', en: 'Merchant id' },
  filterAnyStatus: { es: 'Cualquier estado', en: 'Any status' },
  auditSourcePanel: { es: 'Panel', en: 'Panel' },
  auditSourceAgent: { es: 'Agente', en: 'Agent' },
  // Las llaves vivas: no qué se hizo, sino qué está habilitado a hacerse.
  auditSourceKeys: { es: 'Llaves', en: 'Keys' },
  keysName: { es: 'Llave', en: 'Key' },
  keysType: { es: 'Tipo', en: 'Type' },
  keysType_mcp: { es: 'MCP', en: 'MCP' },
  keysType_oauth: { es: 'Conector', en: 'Connector' },
  keysScope: { es: 'Alcance', en: 'Scope' },
  keysLastUsed: { es: 'Último uso', en: 'Last used' },
  keysActive: { es: 'Activa', en: 'Active' },
  keysRevoked: { es: 'Revocada', en: 'Revoked' },
  risk_lectura: { es: 'Lectura', en: 'Read' },
  risk_reversible: { es: 'Reversible', en: 'Reversible' },
  risk_irreversible: { es: 'Irreversible', en: 'Irreversible' },
  colAction: { es: 'Qué', en: 'What' },
  colTarget: { es: 'Sobre', en: 'On' },

  // ── Lista de espera ──
  waitlistTitle: { es: 'Lista de espera', en: 'Waitlist' },
  colSource: { es: 'Origen', en: 'Source' },

  // ── Clave de IA de la plataforma ──
  sectionAiKey: { es: 'IA y voz', en: 'AI & voice' },
  sectionPlatformWhatsapp: { es: 'WhatsApp', en: 'WhatsApp' },
  sectionPlatformWhatsappDesc: {
    es: 'El número con el que Riverz avisa a los comercios. Aparte del de cada cuenta.',
    en: "The number Riverz uses to alert merchants. Separate from each account's own.",
  },
  sectionAiKeyDesc: {
    es: 'Con qué modelo trabaja Riverz, y quién paga la IA de cada cuenta.',
    en: "Which model Riverz runs on, and who pays for each account's AI.",
  },
  // El título de la pestaña de texto. Decía «Clave de IA» y ya no se carga
  // ninguna clave acá: se carga en Proveedores → Llaves.
  aiKeyTitle: { es: 'Quién paga la IA', en: 'Who pays for the AI' },
  aiKeySubtitle: {
    es: 'Riverz pone la clave y decide a qué cuentas cubre. Las demás traen la suya.',
    en: 'Riverz supplies the key and decides which accounts it covers. The rest bring their own.',
  },
  aiKeyTheKey: { es: 'Clave de Anthropic', en: 'Anthropic key' },
  aiKeyLoaded: { es: 'cargada', en: 'loaded' },
  aiKeyReplace: {
    es: 'Pegar una clave nueva para reemplazarla',
    en: 'Paste a new key to replace it',
  },
  aiKeyWhoTitle: { es: 'A quién cubre', en: 'Who it covers' },
  aiKeyModeAll: { es: 'Todas', en: 'All' },
  aiKeyModeAllHint: {
    es: 'Cualquier cuenta usa la clave de Riverz',
    en: 'Every account uses the Riverz key',
  },
  aiKeyModeSelected: { es: 'Solo las elegidas', en: 'Selected only' },
  aiKeyModeSelectedHint: {
    es: 'El resto trae la suya',
    en: 'The rest bring their own',
  },
  aiKeyModeOff: { es: 'Ninguna', en: 'None' },
  aiKeyModeOffHint: {
    es: 'Todas traen la suya',
    en: 'Everyone brings their own',
  },
  aiKeySpendPlatform: {
    es: 'Paga Riverz · {days} días',
    en: 'Riverz pays · {days} days',
  },
  aiKeySpendOwn: {
    es: 'Paga el comercio · {days} días',
    en: 'Merchant pays · {days} days',
  },
  aiKeyCovered: { es: 'Cuentas cubiertas', en: 'Accounts covered' },
  aiKeyByAccount: { es: 'Por cuenta', en: 'By account' },
  aiKeyColAccount: { es: 'Cuenta', en: 'Account' },
  aiKeyColCalls: { es: 'Respuestas', en: 'Replies' },
  aiKeyColRiverz: { es: 'Paga Riverz', en: 'Riverz pays' },
  aiKeyColOwn: { es: 'Paga el comercio', en: 'Merchant pays' },
  aiKeyColCovered: { es: 'Cubierta', en: 'Covered' },
  aiKeyAllOn: { es: 'Todas', en: 'All' },
  aiKeySaved: { es: 'Guardado', en: 'Saved' },
  aiKeySaveError: { es: 'No se pudo guardar', en: 'Could not save' },
  aiKeyNoFallback: {
    es: '{name} queda sin clave propia: dejará de responder',
    en: '{name} has no key of its own: it will stop replying',
  },

  // Interruptor del cobro manual
  suspendTitle: { es: 'Acceso de la cuenta', en: 'Account access' },
  suspendActive: { es: 'Activa.', en: 'Active.' },
  suspendedSince: { es: 'Suspendida el {date}.', en: 'Suspended on {date}.' },
  suspendReasonPlaceholder: {
    es: 'Motivo (nota interna, opcional)',
    en: 'Reason (internal note, optional)',
  },
  suspendCta: { es: 'Suspender', en: 'Suspend' },
  resumeCta: { es: 'Reactivar', en: 'Reactivate' },
  suspendDone: { es: 'Cuenta suspendida', en: 'Account suspended' },
  resumeDone: { es: 'Cuenta reactivada', en: 'Account reactivated' },
  suspendError: { es: 'No se pudo cambiar', en: "Couldn't change it" },
  suspendHint: {
    es: 'Saca al comercio del panel y frena sus envíos automáticos. No borra nada.',
    en: 'Locks the merchant out of the dashboard and stops their automated sends. Nothing is deleted.',
  },

  // El motor: muda hacia afuera, pero con panel. El otro interruptor.
  motorTitle: { es: 'Motor de la cuenta', en: 'Account engine' },
  motorOn: {
    es: 'Encendido: la cuenta opera.',
    en: 'On: the account is operating.',
  },
  motorOffSince: {
    es: 'Apagado desde el {date}. No sale ningún mensaje.',
    en: 'Off since {date}. No messages are going out.',
  },
  motorOnCta: { es: 'Encender', en: 'Turn on' },
  motorOffCta: { es: 'Apagar', en: 'Turn off' },
  motorOnDone: { es: 'Motor encendido', en: 'Engine on' },
  motorOffDone: { es: 'Motor apagado', en: 'Engine off' },
  motorError: { es: 'No se pudo cambiar', en: "Couldn't change it" },
  motorHint: {
    es: 'Frena todo lo que sale, respuestas, automatizaciones, difusión y llamadas,; el comercio sigue entrando al panel.',
    en: 'Stops everything outbound: replies, automations, broadcasts and calls. The merchant still gets into the dashboard.',
  },

  // ── Códigos de invitación ──
  sectionCodes: { es: 'Códigos', en: 'Codes' },
  sectionCodesDesc: {
    es: 'Códigos de invitación: sin uno no se puede crear cuenta.',
    en: "Invitation codes: an account can't be created without one.",
  },
  codesTitle: { es: 'Códigos de invitación', en: 'Invitation codes' },
  codesActive: { es: 'Disponibles', en: 'Available' },
  codesRedeemed: { es: 'Usados', en: 'Redeemed' },
  codesNewTitle: { es: 'Emitir códigos', en: 'Issue codes' },
  codesNotePlaceholder: { es: 'Para qué es', en: "What it's for" },
  codesMaxUses: { es: 'Usos', en: 'Uses' },
  codesExpiresDays: { es: 'Vence en (días)', en: 'Expires in (days)' },
  codesNoExpiry: { es: 'Sin vencimiento', en: 'No expiry' },
  codesQuantity: { es: 'Cantidad', en: 'How many' },
  codesCreate: { es: 'Emitir', en: 'Issue' },
  codesCreating: { es: 'Emitiendo…', en: 'Issuing…' },
  codesCreated: { es: '{n} código(s) emitido(s)', en: '{n} code(s) issued' },
  codesCreateError: {
    es: 'No se pudo emitir el código.',
    en: "We couldn't issue the code.",
  },
  colCode: { es: 'Código', en: 'Code' },
  colUses: { es: 'Usos', en: 'Uses' },
  colRedeemedBy: { es: 'Lo usó', en: 'Redeemed by' },
  colNote: { es: 'Nota', en: 'Note' },
  colExpires: { es: 'Vence', en: 'Expires' },
  copyCode: { es: 'Copiar', en: 'Copy' },
  codeStatus_active: { es: 'Disponible', en: 'Available' },
  codeStatus_used_up: { es: 'Agotado', en: 'Used up' },
  codeStatus_expired: { es: 'Vencido', en: 'Expired' },
  codeStatus_revoked: { es: 'Revocado', en: 'Revoked' },
  codeRevoke: { es: 'Revocar', en: 'Revoke' },
  codeReactivate: { es: 'Reactivar', en: 'Reactivate' },

  // ── La caja ──
  sectionCash: { es: 'La caja', en: 'Cash' },
  sectionCashDesc: {
    es: 'Cuánta plata hay, cuántos días aguanta y qué recargar ahora.',
    en: 'How much money there is, how many days it lasts and what to top up now.',
  },
  cashTitle: { es: 'La caja', en: 'Cash' },
  cashDesc: {
    es: 'Stripe cobra hoy y deposita en dos días hábiles; los proveedores cobran por adelantado. Este es el hueco.',
    en: 'Stripe charges today and deposits in two business days; providers charge upfront. This is the gap.',
  },
  cashTabMargin: { es: 'Margen del saldo', en: 'Wallet margin' },
  cashMarginVariableOnly: {
    es: 'Consumo variable de IA, voz y datos. No incluye mensualidades de proveedores.',
    en: 'Variable AI, voice and data usage. Provider subscriptions are excluded.',
  },
  cashMarginCost: { es: 'Costo real', en: 'Actual cost' },
  cashMarginCharged: { es: 'Descontado', en: 'Debited' },
  cashMarginDifference: { es: 'Diferencia neta', en: 'Net difference' },
  cashMarginDifferenceHint: {
    es: 'Requiere revisar la conciliación.',
    en: 'Reconciliation needs review.',
  },
  cashMarginBalanced: { es: 'Margen neto 0%.', en: '0% net margin.' },
  cashMarginReserved: { es: 'Reservado', en: 'Reserved' },
  cashMarginPending: {
    es: '{n} operación(es) pendiente(s)',
    en: '{n} pending operation(s)',
  },
  cashMarginProviders: { es: 'Por proveedor', en: 'By provider' },
  cashMarginUses: { es: 'Movimientos', en: 'Entries' },
  cashMarginCovered: { es: 'Cubierto', en: 'Covered' },
  cashMarginReview: { es: 'Revisar', en: 'Review' },
  cashMarginRounding: {
    es: 'Fracción acumulada para el próximo descuento: {usd}.',
    en: 'Fraction carried into the next debit: {usd}.',
  },

  cashFree: { es: 'Caja libre', en: 'Free cash' },
  cashFreeHint: {
    es: 'Stripe más proveedores, menos el saldo que se les debe a los comercios.',
    en: 'Stripe plus providers, minus the balance owed to merchants.',
  },
  cashInStripe: { es: 'En Stripe', en: 'In Stripe' },
  cashInProviders: { es: 'En proveedores', en: 'In providers' },
  cashInProvidersHint: {
    es: 'Prepago cargado: es lo que se gasta cuando un comercio usa la IA.',
    en: 'Prepaid balance: this is what merchants spend when they use the AI.',
  },
  cashRunway: { es: 'Autonomía', en: 'Runway' },
  cashRunwayDays: { es: '{n} días', en: '{n} days' },
  cashRunwayHint: {
    es: 'Al ritmo de la última semana: US${usd} por día.',
    en: "At last week's pace: US${usd} per day.",
  },
  cashRunwayPartial: {
    es: 'Sólo cubre lo que publica saldo, a US${usd} por día. No entran: {nombres}.',
    en: 'Only covers what publishes a balance, at US${usd} a day. Not included: {nombres}.',
  },
  cashRunwayUnknown: {
    es: 'Sin consumo medido esta semana.',
    en: 'No consumption measured this week.',
  },
  // No todos los que faltan es porque no publiquen: ElevenLabs da caracteres,
  // que no son dólares y sumarlos daría un total falso. «No suman» es cierto
  // para los dos casos; «no publican» sólo para uno.
  cashUnmeasured: {
    es: 'No suman al total: {nombres}. Es un piso.',
    en: "Not counted in the total: {nombres}. It's a floor.",
  },
  cashDebt: { es: 'Saldo que se debe', en: 'Balance owed' },
  cashDebtHint: {
    es: 'Cobrado a comercios y todavía sin consumir. Es deuda, no ingreso.',
    en: "Charged to merchants and not yet consumed. It's debt, not revenue.",
  },
  cashFixed: { es: 'Fijo del mes (CRM)', en: 'Monthly fixed (CRM)' },

  cashStepsTitle: { es: 'Qué hacer ahora', en: 'What to do now' },
  cashAllClear: {
    es: 'Nada por hacer: hay colchón para más de {n} días.',
    en: "Nothing to do: there's a cushion for more than {n} days.",
  },
  cashStepNoStripe: {
    es: 'Falta STRIPE_SECRET_KEY: no se puede ver cuánta plata entró.',
    en: "STRIPE_SECRET_KEY is missing: there's no way to see money coming in.",
  },
  cashStepEmpty: {
    es: '{nombre} está en cero. Lo que dependa de él no responde.',
    en: "{nombre} is at zero. Anything depending on it won't respond.",
  },
  cashStepLow: {
    es: '{nombre} queda bajo: {usd}.',
    en: '{nombre} is running low: {usd}.',
  },
  cashStepCushion: {
    es: 'Cargá {usd} en los proveedores para cubrir {dias} días.',
    en: 'Top up {usd} across providers to cover {dias} days.',
  },
  cashStepDebt: {
    es: 'El saldo que se debe supera la caja por {usd}: se está gastando plata de los comercios.',
    en: 'Owed balance exceeds cash by {usd}: merchant money is being spent.',
  },
  cashStepPayout: {
    es: 'Hay {usd} liquidados en Stripe para transferir.',
    en: "There's {usd} settled in Stripe to pay out.",
  },

  cashStripeTitle: { es: 'Stripe: lo que entra', en: 'Stripe: money in' },
  cashAvailable: { es: 'Disponible', en: 'Available' },
  cashAvailableHint: {
    es: 'Liquidado. Se puede transferir hoy.',
    en: 'Settled. Can be paid out today.',
  },
  cashPending: { es: 'Retenido', en: 'Pending' },
  cashPendingHint: {
    es: 'Cobrado y esperando los dos días hábiles.',
    en: 'Charged and waiting out the two business days.',
  },
  cashInstant: { es: 'Instantáneo', en: 'Instant' },
  cashInstantHint: {
    es: 'Llega en 30 minutos y cuesta 1,5% (mínimo US$0,50). Sólo para emergencias.',
    en: 'Arrives in 30 minutes and costs 1.5% (US$0.50 minimum). Emergencies only.',
  },
  cashInstantNo: {
    es: 'La cuenta todavía no es elegible.',
    en: "The account isn't eligible yet.",
  },
  cashSchedule: { es: 'Agenda', en: 'Schedule' },
  cashSchedule_daily: { es: 'Diaria', en: 'Daily' },
  cashSchedule_weekly: { es: 'Semanal', en: 'Weekly' },
  cashSchedule_monthly: { es: 'Mensual', en: 'Monthly' },
  cashSchedule_manual: { es: 'Manual', en: 'Manual' },
  cashScheduleValue: {
    es: '{intervalo}, {dias} días hábiles',
    en: '{intervalo}, {dias} business days',
  },
  cashOnTheWay: { es: 'En camino', en: 'On the way' },
  cashArrives: { es: 'Llega {fecha}', en: 'Arrives {fecha}' },

  cashProvidersTitle: {
    es: 'Dónde está puesta la plata',
    en: 'Where the money sits',
  },
  cashColProvider: { es: 'Proveedor', en: 'Provider' },
  cashColBalance: { es: 'Saldo', en: 'Balance' },
  cashColDays: { es: 'Días', en: 'Days' },

  cashCostsTitle: { es: 'Lo que cuesta recargar', en: 'What topping up costs' },
  cashCostsDesc: {
    es: 'No es el precio por uso: es la fricción de meterle plata a cada plataforma.',
    en: 'Not the usage price: the friction of putting money into each platform.',
  },
  cashColModel: { es: 'Cobro', en: 'Billing' },
  cashColFee: { es: 'Recargo', en: 'Fee' },
  cashColMin: { es: 'Mínimo', en: 'Minimum' },
  cashColExpiry: { es: 'Vencimiento', en: 'Expiry' },
  cashModel_prepago: { es: 'Prepago', en: 'Prepaid' },
  cashModel_suscripcion: { es: 'Suscripción', en: 'Subscription' },
  cashModel_mixto: { es: 'Prepago o pospago', en: 'Prepaid or postpaid' },
  cashNoExpiry: { es: 'No vencen', en: 'Never' },
  cashExpiryMonths: { es: '{n} meses', en: '{n} months' },
  cashExpiryCycle: { es: 'Al cerrar el ciclo', en: 'End of cycle' },

  cashNoteAnthropic: {
    es: 'No compres más de dos meses de consumo por adelantado: vencen.',
    en: "Don't prepay more than two months of usage: credits expire.",
  },
  cashNoteTelnyx: {
    es: 'Pagá por ACH: la tarjeta agrega 3%.',
    en: 'Pay by ACH: card adds 3%.',
  },
  cashNoteDeepgram: {
    es: 'Los créditos comprados no vencen. La auto-recarga viene en 100 al bajar de 10.',
    en: 'Purchased credits never expire. Auto-reload defaults to 100 when below 10.',
  },
  cashNoteFish: {
    es: 'El saldo prepago define la concurrencia: 5, 15 o 50 pedidos.',
    en: 'Prepaid balance sets concurrency: 5, 15 or 50 requests.',
  },
  cashNoteGemini: {
    es: 'En pospago se cobra solo al pasar un umbral; en prepago hay auto-recarga.',
    en: 'Postpaid charges when a threshold is crossed; prepaid has auto-reload.',
  },
  cashNoteElevenlabs: {
    es: 'Bajar de plan o cancelar quema lo no usado.',
    en: 'Downgrading or cancelling forfeits unused credits.',
  },
  cashNoteFirecrawl: {
    es: 'Los créditos del plan no se acumulan; los de los packs sí.',
    en: "Plan credits don't roll over; top-up packs do.",
  },
  cashNoteApify: {
    es: 'El uso prepago del plan vence al cerrar el ciclo.',
    en: "The plan's prepaid usage expires at the end of the cycle.",
  },
  cashNoteMeta: {
    es: 'Sin método de pago válido bloquea los envíos; recibir sigue funcionando.',
    en: 'Without a valid payment method it blocks sending; receiving still works.',
  },

  cashFeesTitle: { es: 'Lo que cobra Stripe', en: 'What Stripe charges' },
  cashFeeCard: {
    es: 'Tarjeta: 2,9% + US$0,30. Tarjeta extranjera: +1,5%. Conversión de moneda: +1%.',
    en: 'Card: 2.9% + US$0.30. International card: +1.5%. Currency conversion: +1%.',
  },
  cashFeeDispute: {
    es: 'Contracargo: US$15 por cada uno, que se devuelven si se gana.',
    en: 'Chargeback: US$15 each, refunded if won.',
  },
  cashFeePayout: {
    es: 'Transferencia estándar: gratis, dos días hábiles. Instantánea: 1,5%, mínimo US$0,50, tope US$9.999 y diez por día.',
    en: 'Standard payout: free, two business days. Instant: 1.5%, US$0.50 minimum, US$9,999 cap and ten per day.',
  },
  cashFeeWallet: {
    es: 'La recarga acredita el bruto y la comisión la paga Riverz: entre 4,7% y 14,4% según el monto.',
    en: 'A top-up credits the gross amount and Riverz pays the fee: 4.7% to 14.4% depending on size.',
  },
} satisfies Namespace;
