import type { Namespace } from "./types";

/** Dashboard (/panel): metrics, charts, activity feed, date filter, setup checklist. */
export const dashboard = {
  caseReasons_title: { es:'Motivos y satisfacción',en:'Reasons and satisfaction' },
  caseReasons_scope: { es:'Casos iniciados en el período, sin eliminados ni spam. Motivo y valoración actuales; satisfacción no equivale a resolución. Hasta 180 días por período.',en:'Cases started in the period, excluding deleted cases and spam. Current reason and rating; satisfaction is not resolution. Up to 180 days per period.' },
  caseReasons_reasonColumn: { es:'Motivo',en:'Reason' },
  caseReasons_currentCases: { es:'Casos',en:'Cases' },
  caseReasons_previousCases: { es:'Período anterior',en:'Previous period' },
  caseReasons_ratedCases: { es:'Con valoración',en:'Rated' },
  caseReasons_positiveCases: { es:'Valoraciones positivas',en:'Positive ratings' },
  caseReasons_satisfaction: { es:'Positivas / valoraciones',en:'Positive / rated' },
  caseReasons_periodStart: { es:'Inicio del período',en:'Period start' },
  caseReasons_periodEnd: { es:'Fin exclusivo del período',en:'Exclusive period end' },
  caseReasons_previousStart: { es:'Inicio anterior',en:'Previous start' },
  caseReasons_previousEnd: { es:'Fin exclusivo anterior',en:'Previous exclusive end' },
  caseReasons_observedAt: { es:'Consultado en',en:'Observed at' },
  caseReasons_observed: { es:'Consultado: {date}',en:'Observed: {date}' },
  caseReasons_export: { es:'Exportar CSV',en:'Export CSV' },
  caseReasons_refresh: { es:'Actualizar',en:'Refresh' },
  caseReasons_openCase: { es:'Abrir caso · {date}',en:'Open case · {date}' },
  caseReasons_older: { es:'Ver anteriores',en:'View older' },
  caseReasons_unavailable: { es:'Este reporte no está disponible.',en:'This report is unavailable.' },
  caseReasons_invalid: { es:'El período o filtro no es válido.',en:'Invalid period or filter.' },
  caseReasons_failed: { es:'No se pudo consultar el reporte.',en:'Could not load the report.' },
  outcomeMixedCurrencies: {
    es: 'Hay varias monedas; no se suman entre sí',
    en: 'Multiple currencies; amounts are not added together',
  },
  outcomeTitle: { es: 'Resultados de Riverz', en: 'Riverz results' },
  outcomeResolved: {
    es: 'Casos resueltos verificados',
    en: 'Verified resolutions',
  },
  outcomeResolvedSub: {
    es: 'Revisados por tu equipo · Sin respuestas humanas',
    en: 'Reviewed by your team · No human replies',
  },
  outcomeRate: {
    es: 'Resolución sin tu equipo',
    en: 'Resolution without your team',
  },
  outcomeRateSub: {
    es: 'Verificados: {n} de {total} atendidos',
    en: '{n} verified out of {total} handled cases',
  },
  outcomePending: { es: 'Necesitan una persona', en: 'Need a person' },
  outcomePendingSub: {
    es: 'Pendientes ahora · Todos los períodos',
    en: 'Pending now · All periods',
  },
  outcomeSales: {
    es: 'Ventas con atribución directa',
    en: 'Directly attributed sales',
  },
  outcomeAssisted:{es:'Ventas después de conversar',en:'Sales after a conversation'},
  outcomeAssistedSub:{es:'{n} pedidos pagados · Sin atribución directa',en:'{n} paid orders · No direct attribution'},
  outcomeSalesSub: {
    es: '{n} pedidos pagados · Ver evidencia',
    en: '{n} paid orders · View evidence',
  },
  outcomeConnectStore: {
    es: 'Conecta tu tienda para medir ventas',
    en: 'Connect your store to measure sales',
  },
  outcomeSalesUnavailable: {
    es: 'Sin datos de ventas disponibles',
    en: 'Sales data unavailable',
  },
  outcomeEvidence: { es: 'Casos y evidencia', en: 'Cases and evidence' },
  outcomeMethod: {
    es: 'Estado actual de casos atendidos por IA o revisados en el período. Una respuesta o el silencio del cliente no prueban una resolución.',
    en: 'Current status of cases handled by AI or reviewed in this period. A reply or customer silence does not prove resolution.',
  },
  outcomeTab_review: { es: 'Por verificar', en: 'To verify' },
  outcomeTab_verified: { es: 'Verificados', en: 'Verified' },
  outcomeTab_human: { es: 'Con intervención', en: 'Human involvement' },
  outcomeTab_pending: { es: 'Pendientes ahora', en: 'Pending now' },
  outcomeBreakdown: { es: 'Trabajo verificado', en: 'Verified work' },
  outcomeCategory_tracking: {
    es: 'Seguimiento de pedidos',
    en: 'Order tracking',
  },
  outcomeCategory_product: {
    es: 'Consultas de productos',
    en: 'Product questions',
  },
  outcomeCategory_confirmation: {
    es: 'Confirmaciones de pedidos',
    en: 'Order confirmations',
  },
  outcomeCategory_address: {
    es: 'Cambios de dirección',
    en: 'Address changes',
  },
  outcomeCategory_return: { es: 'Devoluciones', en: 'Returns' },
  outcomeCategory_other: { es: 'Otros casos', en: 'Other cases' },
  outcomeTemporal: {
    es: 'Compras posteriores a una interacción, sin evidencia directa',
    en: 'Purchases after an interaction, without direct evidence',
  },
  outcomeContact: { es: 'Contacto', en: 'Contact' },
  outcomeOpen: { es: 'Abrir conversación', en: 'Open conversation' },
  outcomeOpenNew: {
    es: 'Abrir conversación en otra pestaña',
    en: 'Open conversation in a new tab',
  },
  outcomeReview: { es: 'Verificar resultado', en: 'Verify outcome' },
  outcomeEdit: { es: 'Revisar verificación', en: 'Review verification' },
  outcomeReviewHelp: {
    es: 'Revisa la conversación y comprueba que la consulta o acción quedó resuelta. Si llegan mensajes nuevos, la verificación deja de contar.',
    en: 'Review the conversation and check that the question or action was resolved. New messages invalidate this verification.',
  },
  outcomeCategory: { es: 'Caso resuelto', en: 'Resolved case' },
  outcomeConfirm: {
    es: 'He revisado la conversación y comprobado que Riverz resolvió el caso correctamente.',
    en: 'I reviewed the conversation and confirmed that Riverz resolved the case correctly.',
  },
  outcomeSave: { es: 'Confirmar resolución', en: 'Confirm resolution' },
  outcomeSaving: { es: 'Guardando…', en: 'Saving…' },
  outcomeRemove: { es: 'Quitar verificación', en: 'Remove verification' },
  outcomeSaved: { es: 'Resolución verificada', en: 'Resolution verified' },
  outcomeRemoved: { es: 'Verificación eliminada', en: 'Verification removed' },
  outcomeRetry: { es: 'Reintentar', en: 'Retry' },
  outcomeLoading: { es: 'Cargando resultados…', en: 'Loading results…' },
  outcomeEmpty_review: {
    es: 'No hay casos pendientes de verificación en este período.',
    en: 'No cases awaiting verification in this period.',
  },
  outcomeEmpty_verified: {
    es: 'Todavía no hay resoluciones verificadas en este período.',
    en: 'No verified resolutions in this period yet.',
  },
  outcomeEmpty_human: {
    es: 'No hay casos con intervención humana en este período.',
    en: 'No cases with human involvement in this period.',
  },
  outcomeEmpty_pending: {
    es: 'No hay conversaciones escaladas pendientes.',
    en: 'No escalated conversations pending.',
  },
  outcomePrevious: { es: 'Anterior', en: 'Previous' },
  outcomeNext: { es: 'Siguiente', en: 'Next' },
  outcomeTrial: { es: 'Resultados de tu prueba', en: 'Your trial results' },
  outcomeTrialHelp: {
    es: 'Revisa los casos y resultados del período seleccionado.',
    en: 'Review cases and results for the selected period.',
  },
  outcomeTrialUntil: {
    es: 'Prueba configurada hasta {date}',
    en: 'Trial configured until {date}',
  },
  outcomeActivity: { es: 'Actividad y volumen', en: 'Activity and volume' },
  outcomeUnauthorized: {
    es: 'Inicia sesión para consultar los resultados.',
    en: 'Sign in to view results.',
  },
  outcomeForbidden: { es: 'No tienes acceso a estos reportes y casos.', en: 'You do not have access to these reports and cases.' },
  timingTitle: { es: 'Evidencia y tiempos de revisión', en: 'Evidence and review timing' },
  timingBasis: { es: 'Desde el primer mensaje del cliente en el hilo hasta la revisión vigente del equipo. Incluye la espera para revisar; no mide automáticamente la resolución.', en: 'From the first customer message in the thread to the current team review. Includes review delay; does not measure resolution automatically.' },
  timingMedian: { es: 'Mediana hasta revisión', en: 'Median time to review' },
  timingSample: { es: '{count} casos medidos', en: '{count} measured cases' },
  timingMissing: { es: '{count} sin fechas suficientes', en: '{count} with insufficient dates' },
  timingDownload: { es: 'Exportar evidencia CSV', en: 'Export evidence CSV' },
  timingCase: { es: 'Caso', en: 'Case' },
  timingMessage: { es: 'Mensaje revisado', en: 'Reviewed message' },
  timingChannel: { es: 'Canal', en: 'Channel' },
  timingState: { es: 'Estado', en: 'Status' },
  timingCategory: { es: 'Categoría', en: 'Category' },
  timingStart: { es: 'Primer mensaje del cliente', en: 'First customer message' },
  timingReview: { es: 'Revisión vigente', en: 'Current review' },
  timingSeconds: { es: 'Segundos hasta revisión', en: 'Seconds to review' },
  timingFrom: { es: 'Inicio de ventana', en: 'Window start' },
  timingThrough: { es: 'Fin exclusivo de ventana', en: 'Exclusive window end' },
  timingState_all: { es: 'Todos', en: 'All' },
  timingState_verified: { es: 'Verificado por el equipo', en: 'Team verified' },
  timingState_review: { es: 'Por revisar', en: 'Needs review' },
  timingState_human: { es: 'Con intervención humana', en: 'Human assisted' },
  timingOpenCase: { es: 'Abrir caso', en: 'Open case' },
  timingEmpty: { es: 'No hay casos en este filtro.', en: 'No cases match this filter.' },
  timingMore: { es: 'Mostrar más', en: 'Show more' },
  outcomeReadOnly: { es: 'La cuenta está en modo de lectura.', en: 'This account is in read-only mode.' },
  outcomeInvalid: {
    es: 'Revisa los datos o el período seleccionado.',
    en: 'Check the submitted data or selected period.',
  },
  outcomeNotFound: {
    es: 'No se encontró un caso de IA en esta cuenta.',
    en: 'No AI case was found in this account.',
  },
  outcomeChanged: {
    es: 'La conversación cambió o necesitó una persona. Vuelve a revisarla.',
    en: 'The conversation changed or needed a person. Review it again.',
  },
  outcomeLoadFailed: {
    es: 'No se pudieron cargar los resultados.',
    en: 'Results could not be loaded.',
  },
  outcomeSaveFailed: {
    es: 'No se pudo guardar la verificación.',
    en: 'The verification could not be saved.',
  },
  // Page header
  home: { es: "Inicio", en: "Home" },
  overview: { es: "Resumen", en: "Overview" },

  // Live indicator
  realtimeData: { es: "Datos en tiempo real", en: "Real-time data" },
  noLiveConnection: { es: "Sin conexión en vivo", en: "No live connection" },
  live: { es: "En vivo", en: "Live" },
  offline: { es: "Sin conexión", en: "Offline" },

  // Metric cards
  conversations: { es: "Conversaciones", en: "Conversations" },
  newContacts: { es: "Contactos nuevos", en: "New contacts" },
  resolved: { es: "Resueltas", en: "Resolved" },
  messagesReceived: { es: "Mensajes recibidos", en: "Messages received" },
  messagesSent: { es: "Mensajes enviados", en: "Messages sent" },

  setupWithAssistant: {
    es: "Que lo haga el asistente",
    en: "Let the assistant do it",
  },

  // Tarjetas de retorno: qué devolvió Riverz, no cuánto se movió.
  roiRevenue: { es: "Ingresos comprobados por Riverz", en: "Revenue proven from Riverz" },
  roiRevenueSub: {
    es: "{orders} pedidos comprobados · {share}% de las ventas",
    en: "{orders} proven orders · {share}% of sales",
  },
  roiRevenueNone: { es: "Todavía sin ingresos comprobados", en: "No proven revenue yet" },
  roiAssistedRevenue: { es: "Ventas influenciadas", en: "Influenced sales" },
  roiAssistedRevenueSub: {
    es: "{orders} pedidos tras una interacción con Riverz",
    en: "{orders} orders after an interaction with Riverz",
  },
  roiAssistedRevenueNone: { es: "Todavía sin ventas influenciadas", en: "No influenced sales yet" },

  // La cifra, abierta: qué está probado y qué no.
  attrDetailTitle: { es: "De dónde sale esta cifra", en: "Where this number comes from" },
  attrRange: { es: "Del {desde} al {hasta}", en: "From {desde} to {hasta}" },
  attrModel: {
    es: "Los ingresos comprobados tienen evidencia directa. Las ventas influenciadas se muestran aparte: Riverz habló con la persona, pero no se afirma causalidad. Abre el chat desde cualquier pedido.",
    en: "Proven revenue has direct evidence. Influenced sales are shown separately: Riverz spoke with the person, but causality is not claimed. Open the chat from any order.",
  },
  attrTotalLine: { es: "{total} en {orders} pedidos", en: "{total} across {orders} orders" },

  attrProvenTitle: { es: "Comprobadas", en: "Proven" },
  attrProvenHelp: {
    es: "El pedido pagado tiene una marca de Riverz: enlace, carrito, pedido o cupón. Esto demuestra participación, no ventas adicionales.",
    en: "The paid order carries a Riverz link, cart, order or coupon marker. This proves participation, not incremental sales.",
  },
  attrProvenEmpty: {
    es: "Ningún pedido de este rango lleva marca de Riverz.",
    en: "No order in this range carries a Riverz stamp.",
  },
  attrAssistedTitle: { es: "Influidas", en: "Assisted" },
  attrAssistedHelp: {
    es: "Riverz les escribió en las 72 h previas y compraron. Ayudó a cerrar, aunque el pedido no traiga marca.",
    en: "Riverz messaged them within 72h and they bought. It helped close the sale, even with no stamp on the order.",
  },
  attrFromAd: { es: "vino de un anuncio", en: "came from an ad" },

  proofOrderCreated: { es: "Pedido creado por Riverz", en: "Order created by Riverz" },
  proofCheckoutLink: { es: "Pagó por un link de Riverz", en: "Paid via a Riverz link" },
  proofWebchatCart: { es: "Carrito del chat", en: "Cart from the chat" },
  proofCoupon: { es: "Cupón de Riverz", en: "Riverz coupon" },
  proofCartRecovery: {
    es: "Carrito recuperado por Riverz",
    en: "Cart recovered by Riverz",
  },
  proofLinkClick: {
    es: "Entró por un link de Riverz",
    en: "Came in through a Riverz link",
  },
  proofPaymentRecovered: {
    es: "Pago rechazado que volvió",
    en: "Recovered failed payment",
  },

  attrTruncated: {
    es: "Se muestran los {n} pedidos más grandes. Los totales los cuentan todos.",
    en: "Showing the {n} largest orders. Totals count them all.",
  },

  // La venta que Riverz cierra y no puede probar: se cierra hablando y
  // alguien la carga a mano en la tienda. No hay dato que la delate, así que
  // se pregunta.
  ventasAManoTitle: {
    es: "¿Cierras ventas hablando?",
    en: "Do you close sales over chat?",
  },
  ventasAManoHelp: {
    es: "Esta cifra cuenta las ventas donde Riverz habló con la persona. Si cierras la venta hablando y cargas el pedido en otro sistema, no aparece aquí.",
    en: "This number counts sales where Riverz talked to the customer. If you close the sale over chat and enter the order in another system, it won't show up here.",
  },
  ventasAManoSeguido: { es: "Casi todos los días", en: "Most days" },
  ventasAManoAVeces: { es: "A veces", en: "Sometimes" },
  ventasAManoCasiNunca: { es: "Casi nunca", en: "Almost never" },
  ventasAManoLater: { es: "Ahora no", en: "Not now" },
  ventasAManoThanks: {
    es: "Gracias. Lo tenemos en cuenta al leer la cifra.",
    en: "Thanks. We'll keep it in mind when reading the number.",
  },
  ventasAManoNota: {
    es: "Nos dijiste que cierras ventas hablando y las cargas a mano: esas no llevan marca y no están en esta lista.",
    en: "You told us you close sales over chat and enter them by hand: those carry no stamp and aren't in this list.",
  },
  roiStoreRevenue: { es: "Ventas de la tienda", en: "Store sales" },
  roiAov: { es: "Ticket promedio", en: "Average order value" },
  roiAiReplies: { es: "Contestó la IA", en: "Answered by AI" },
  roiAiRepliesConvs: { es: "en {n} conversaciones", en: "across {n} conversations" },
  roiFirstReply: { es: "Primera respuesta", en: "First reply" },
  roiMinutes: { es: "{n} min", en: "{n} min" },
  roiNoData: { es: "Sin datos", en: "No data" },

  // Delta suffixes
  vsYesterday: { es: "vs ayer", en: "vs yesterday" },
  vsYesterdaySoFar: { es: "vs ayer a esta hora", en: "vs yesterday so far" },
  vsPreviousDay: { es: "vs día anterior", en: "vs previous day" },
  vsPrevious7d: { es: "vs 7 días previos", en: "vs previous 7 days" },
  vsPrevious30d: { es: "vs 30 días previos", en: "vs previous 30 days" },
  vsPreviousPeriod: { es: "vs período anterior", en: "vs previous period" },
  noChange: { es: "Sin cambios {suffix}", en: "No change {suffix}" },
  deltaChange: { es: "{delta} {suffix}", en: "{delta} {suffix}" },

  // Channel mix card
  channelVolume: { es: "Volumen por canal", en: "Volume by channel" },
  total: { es: "Total", en: "Total" },
  received: { es: "Recibidos", en: "Received" },
  sent: { es: "Enviados", en: "Sent" },

  // Conversations chart
  conversationsOverTime: { es: "Conversaciones en el tiempo", en: "Conversations over time" },
  noActivityInRange: { es: "Sin actividad en este rango", en: "No activity in this range" },
  conversationsPerDay: { es: "Conversaciones por día", en: "Conversations per day" },
  incoming: { es: "Entrantes", en: "Incoming" },
  outgoing: { es: "Salientes", en: "Outgoing" },
  incomingCount: { es: "{n} entrantes", en: "{n} incoming" },
  outgoingCount: { es: "{n} salientes", en: "{n} outgoing" },

  // Response time chart
  avgFirstResponseTime: {
    es: "Tiempo medio de primera respuesta",
    en: "Average first response time",
  },
  avgAllResponseTime: {
    es: "Tiempo medio de respuesta",
    en: "Average response time",
  },
  responseModeFirst: { es: "Primera", en: "First" },
  responseModeAll: { es: "Todas", en: "All" },
  average: { es: "Promedio", en: "Average" },
  previousPeriod: { es: "Período anterior", en: "Previous period" },
  noResponsesRecorded: { es: "Sin respuestas registradas", en: "No responses recorded" },
  noSamples: { es: "sin muestras", en: "no samples" },
  averageValue: { es: "{value} promedio", en: "{value} avg" },
  sampleCountOne: { es: "{n} muestra", en: "{n} sample" },
  sampleCountOther: { es: "{n} muestras", en: "{n} samples" },

  // Activity feed
  recentActivity: { es: "Actividad reciente", en: "Recent activity" },
  loading: { es: "Cargando…", en: "Loading…" },
  viewAll: { es: "Ver todo", en: "View all" },
  noActivity: { es: "Sin actividad", en: "No activity" },

  // Activity feed — item text
  activityNewMessage: { es: "Nuevo mensaje de {who}", en: "New message from {who}" },
  activityNewComment: { es: "Nuevo comentario de {who}", en: "New comment from {who}" },
  activityCallInbound: { es: "Llamada de {who}", en: "Call from {who}" },
  activityCallOutbound: { es: "Llamada a {who}", en: "Call to {who}" },
  activityNewContact: { es: "Nuevo contacto: {who}", en: "New contact: {who}" },
  activityUnknownContact: { es: "Desconocido", en: "Unknown" },
  activitySomeContact: { es: "un contacto", en: "a contact" },
  activityBroadcastSent: {
    es: 'Campaña "{name}" enviada a {n} contactos',
    en: 'Campaign "{name}" sent to {n} contacts',
  },
  activityBroadcastStatus: {
    es: 'Campaña "{name}" {status} ({n} destinatarios)',
    en: 'Campaign "{name}" {status} ({n} recipients)',
  },
  activityAutomationRan: {
    es: 'Automatización "{name}" se ejecutó para {who}',
    en: 'Automation "{name}" ran for {who}',
  },
  activityAutomationFailed: {
    es: 'Automatización "{name}" falló para {who}',
    en: 'Automation "{name}" failed for {who}',
  },
  activityAutomationName: { es: "Automatización", en: "Automation" },
  broadcastStatusDraft: { es: "borrador", en: "draft" },
  broadcastStatusScheduled: { es: "programada", en: "scheduled" },
  broadcastStatusSending: { es: "enviando", en: "sending" },
  broadcastStatusSent: { es: "enviada", en: "sent" },
  broadcastStatusFailed: { es: "fallida", en: "failed" },
  showingOf: { es: "Mostrando {shown} de {total}", en: "Showing {shown} of {total}" },
  agoSeconds: { es: "hace {n}s", en: "{n}s ago" },
  agoMinutes: { es: "hace {n}m", en: "{n}m ago" },
  agoHours: { es: "hace {n}h", en: "{n}h ago" },
  agoDays: { es: "hace {n}d", en: "{n}d ago" },

  // Empty state
  notEnoughData: { es: "Sin datos suficientes", en: "Not enough data" },

  // Date range filter
  rangeToday: { es: "Hoy", en: "Today" },
  rangeYesterday: { es: "Ayer", en: "Yesterday" },
  range7d: { es: "7 días", en: "7 days" },
  range30d: { es: "30 días", en: "30 days" },
  custom: { es: "Personalizado", en: "Custom" },
  rangeTimezone: { es: "Fechas en {tz}", en: "Dates in {tz}" },
  prevMonth: { es: "Mes anterior", en: "Previous month" },
  nextMonth: { es: "Mes siguiente", en: "Next month" },
  pickStartDate: { es: "Elige la fecha inicial", en: "Pick the start date" },
  pickEndDate: { es: "Elige la fecha final…", en: "Pick the end date…" },
  weekdayMon: { es: "L", en: "M" },
  weekdayTue: { es: "M", en: "T" },
  weekdayWed: { es: "X", en: "W" },
  weekdayThu: { es: "J", en: "T" },
  weekdayFri: { es: "V", en: "F" },
  weekdaySat: { es: "S", en: "S" },
  weekdaySun: { es: "D", en: "S" },

  // Setup checklist — steps
  stepConnectChannel: { es: "Conecta un canal", en: "Connect a channel" },
  stepConnectChannelDesc: {
    es: "WhatsApp, Instagram o Facebook. Es por donde recibes y respondes mensajes.",
    en: "WhatsApp, Instagram or Facebook. This is where you receive and reply to messages.",
  },
  stepConnectChannelCta: { es: "Conectar canal", en: "Connect channel" },
  stepCreateProduct: { es: "Crea tu producto", en: "Create your product" },
  stepCreateProductDesc: {
    es: "Funciona sin Shopify. Conectarlo es opcional.",
    en: "Works without Shopify. Connecting it is optional.",
  },
  stepCreateProductCta: { es: "Crear producto", en: "Create product" },
  stepActivateAssistant: { es: "Activa tu asistente de IA", en: "Activate your AI assistant" },
  stepActivateAssistantDesc: {
    es: "Responde con tu catálogo y tu marca, las 24 horas, en cada canal.",
    en: "Replies with your catalog and your brand, 24/7, across every channel.",
  },
  stepActivateAssistantCta: { es: "Activar asistente", en: "Activate assistant" },
  stepFirstReply: { es: "Comprueba que contesta", en: "Check that it replies" },
  stepFirstReplyDesc: {
    es: "Escríbele desde «Probar» o desde tu propio WhatsApp.",
    en: "Message it from «Test» or from your own WhatsApp.",
  },
  stepFirstReplyCta: { es: "Probar el asistente", en: "Test the assistant" },

  // Setup checklist — success state
  setupComplete: { es: "Configuración completa", en: "Setup complete" },
  youAreLive: { es: "Ya estás en vivo", en: "You're live" },
  openInbox: { es: "Abrir bandeja", en: "Open inbox" },
  viewMetrics: { es: "Ver métricas", en: "View metrics" },

  // Setup checklist — header + steps UI
  getAccountRunning: { es: "Pon en marcha tu cuenta", en: "Get your account running" },
  // Parametrizado y no "Tres pasos" fijo: la lista tiene cuatro, así que el
  // título contradecía a lo que el comercio veía debajo — y cualquier paso que
  // se agregue mañana lo vuelve a desincronizar.
  stepsToLive: { es: "{total} pasos para salir en vivo", en: "{total} steps to go live" },
  stepsReady: { es: "{completed} de {total} pasos listos", en: "{completed} of {total} steps done" },
  refreshStatus: { es: "Actualizar estado", en: "Refresh status" },
  hideChecklist: { es: "Ocultar", en: "Hide" },
  done: { es: "Listo", en: "Done" },
  later: { es: "Más adelante", en: "Later" },

  // Quien atendio: por canal y por agente.
  whoOfWithAi: {
    es: "{n} de {total} con IA",
    en: "{n} of {total} with AI",
  },
  whoAnswered: { es: "{n} respondidas", en: "{n} answered" },
  whoSkipped: { es: "{n} se abstuvo", en: "{n} skipped" },
  whoFailed: { es: "{n} falló", en: "{n} failed" },
  whoPaused: { es: "pausado", en: "paused" },
  iaSatisfaction: {
    es: "conformes ({n} calificaron)",
    en: "satisfied ({n} rated)",
  },
} satisfies Namespace;
