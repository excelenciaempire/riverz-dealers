import type { Namespace } from "./types";

/**
 * Voice AI — phone agent settings, inbox call view, integration card,
 * metrics. All user-facing; both locales required.
 */
export const voice = {
  // ── Agent editor · Voz tab ──
  tab: { es: "Llamadas", en: "Calls" },
  enable: { es: "Agente de voz", en: "Voice agent" },
  enableHint: {
    es: "Permite que este agente haga y conteste llamadas por teléfono.",
    en: "Let this agent place and answer phone calls.",
  },
  voiceLabel: { es: "Voz del agente", en: "Agent voice" },
  voicePickHint: {
    es: "La voz con la que hablará el agente. Escúchala antes de elegir.",
    en: "The voice the agent speaks with. Listen before choosing.",
  },
  preview: { es: "Escuchar", en: "Play sample" },
  previewPlaying: { es: "Reproduciendo…", en: "Playing…" },
  customVoiceId: { es: "O pega un ID de voz de ElevenLabs", en: "Or paste an ElevenLabs voice ID" },
  greeting: { es: "Saludo inicial", en: "Opening line" },
  greetingHint: {
    es: "Lo primero que dice al conectar. Usa {{contact_name}} para el nombre.",
    en: "The first thing said on connect. Use {{contact_name}} for the name.",
  },
  objectives: { es: "Objetivos por tipo de llamada", en: "Objectives by call type" },
  objectivesHint: {
    es: "Qué debe lograr el agente en cada tipo de llamada. Si lo dejas vacío, usa un objetivo por defecto.",
    en: "What the agent should accomplish per call type. Left empty, a default is used.",
  },
  objOrderConfirmation: { es: "Confirmar pedido", en: "Confirm order" },
  objCartRecovery: { es: "Recuperar carrito", en: "Recover cart" },
  objFollowup: { es: "Seguimiento (sin respuesta)", en: "Follow-up (no reply)" },
  objInbound: { es: "Llamada entrante", en: "Incoming call" },
  objEnabled: { es: "Activo", en: "On" },
  objPlaceholder: { es: "Describe el objetivo de la llamada…", en: "Describe the call objective…" },
  maxDuration: { es: "Duración máxima (segundos)", en: "Max duration (seconds)" },
  callingHours: { es: "Horario de llamadas", en: "Calling hours" },
  callingHoursHint: {
    es: "Solo se llama dentro de esta franja (zona horaria del espacio de trabajo).",
    en: "Calls only go out inside this window (workspace timezone).",
  },
  from: { es: "Desde", en: "From" },
  to: { es: "Hasta", en: "To" },
  days: { es: "Días", en: "Days" },
  hoursOvernight: {
    es: "Turno noche: sigue hasta esa hora del día siguiente.",
    en: "Overnight: runs until that time the next day.",
  },
  hoursNoDays: {
    es: "Elige al menos un día.",
    en: "Choose at least one day.",
  },
  retries: { es: "Reintentos si no contesta", en: "Retries if no answer" },
  retryDelay: { es: "Espera entre reintentos (min)", en: "Wait between retries (min)" },

  // AI-assisted setup + "AI decides"
  setupTitle: { es: "Configurar con IA", en: "Set up with AI" },
  setupHint: {
    es: "Describe en tus palabras cuándo quieres que el agente llame y lo configuramos por ti.",
    en: "Describe in your words when the agent should call and we set it all up for you.",
  },
  setupPlaceholder: {
    es: "Ej: que llame para confirmar cada pedido y para recuperar carritos si no responden por chat.",
    en: "E.g. call to confirm every order and to recover carts if they don't reply on chat.",
  },
  setupApply: { es: "Generar", en: "Generate" },
  setupApplied: { es: "Configuración aplicada", en: "Configuration applied" },
  setupError: { es: "No se pudo generar la configuración", en: "Couldn't generate the setup" },
  aiDecides: { es: "Dejar que la IA decida cuándo llamar", en: "Let the AI decide when to call" },
  aiDecidesHint: {
    es: "En medio del chat, el agente puede llamar si conviene (cliente lo pide, urgente, alto valor). Respeta horario y 'no llamar'.",
    en: "Mid-chat, the agent can call when it helps (customer asks, urgent, high value). Respects hours and 'do not call'.",
  },

  // ── Weekday short labels (ISO 1=Mon … 7=Sun) ──
  dayMon: { es: "Lun", en: "Mon" },
  dayTue: { es: "Mar", en: "Tue" },
  dayWed: { es: "Mié", en: "Wed" },
  dayThu: { es: "Jue", en: "Thu" },
  dayFri: { es: "Vie", en: "Fri" },
  daySat: { es: "Sáb", en: "Sat" },
  daySun: { es: "Dom", en: "Sun" },

  // ── Inbox · call view ──
  callInbound: { es: "Llamada entrante", en: "Incoming call" },
  callOutbound: { es: "Llamada saliente", en: "Outgoing call" },
  duration: { es: "Duración", en: "Duration" },
  outcome: { es: "Resultado", en: "Outcome" },
  summary: { es: "Resumen", en: "Summary" },
  noTranscript: { es: "Sin transcripción.", en: "No transcript." },
  callWithAi: { es: "Llamar con IA", en: "Call with AI" },
  calling: { es: "Llamando…", en: "Calling…" },
  callQueued: { es: "Llamada en cola", en: "Call queued" },
  callFailed: { es: "No se pudo iniciar la llamada", en: "Could not start the call" },

  // Statuses
  statusQueued: { es: "En cola", en: "Queued" },
  statusDialing: { es: "Marcando", en: "Dialing" },
  statusInProgress: { es: "En curso", en: "In progress" },
  statusCompleted: { es: "Completada", en: "Completed" },
  statusFailed: { es: "Fallida", en: "Failed" },
  statusNoAnswer: { es: "Sin respuesta", en: "No answer" },
  statusBusy: { es: "Ocupado", en: "Busy" },
  statusVoicemail: { es: "Buzón de voz", en: "Voicemail" },
  statusCanceled: { es: "Cancelada", en: "Canceled" },

  // Outcomes
  outcomeConfirmed: { es: "Confirmado", en: "Confirmed" },
  outcomeCancelled: { es: "Cancelado por el cliente", en: "Cancelled by customer" },
  outcomeRescheduled: { es: "Reagendado", en: "Rescheduled" },
  outcomeRecovered: { es: "Compra recuperada", en: "Purchase recovered" },
  outcomeDeclined: { es: "Rechazó", en: "Declined" },
  outcomeCallback: { es: "Pidió que lo vuelvan a llamar", en: "Asked for a callback" },
  outcomeOptOut: { es: "Pidió no ser llamado", en: "Asked not to be called" },
  outcomeNone: { es: "Sin resultado", en: "No outcome" },

  // ── Contact · opt-out ──
  optOut: { es: "No llamar", en: "Do not call" },
  optOutHint: {
    es: "El agente de voz no llamará a este contacto.",
    en: "The voice agent won't call this contact.",
  },

  // ── Integrations · voice card ──
  cardTitle: { es: "Voz / Teléfono", en: "Voice / Phone" },
  cardDesc: {
    es: "Agentes de voz que llaman y contestan por teléfono.",
    en: "Voice agents that call and answer by phone.",
  },
  phoneNumber: { es: "Número asignado", en: "Assigned number" },
  phoneNumberPlaceholder: { es: "+57 …", en: "+1 …" },
  country: { es: "País", en: "Country" },
  inboundEnabled: { es: "Contestar llamadas entrantes", en: "Answer incoming calls" },
  monthlyLimit: { es: "Límite de minutos al mes", en: "Monthly minutes limit" },
  monthlyLimitHint: { es: "0 = sin límite", en: "0 = unlimited" },
  killSwitch: { es: "Pausar todas las llamadas", en: "Pause all calls" },
  killSwitchHint: {
    es: "Detiene de inmediato las llamadas salientes y entrantes.",
    en: "Immediately stops outbound and inbound calls.",
  },
  greetingDelay: { es: "Espera antes de hablar (seg)", en: "Delay before speaking (sec)" },
  outboundFirstSpeaker: { es: "Quién habla primero (salientes)", en: "Who speaks first (outbound)" },
  inboundFirstSpeaker: { es: "Quién habla primero (entrantes)", en: "Who speaks first (inbound)" },
  speakerAgent: { es: "El agente saluda", en: "Agent greets" },
  speakerCustomer: { es: "Espera al cliente", en: "Wait for the customer" },
  recordingEnabled: { es: "Grabar llamadas", en: "Record calls" },
  recordingHint: {
    es: "Agrega un aviso hablado de grabación al saludo, por cumplimiento.",
    en: "Adds a spoken recording disclosure to the greeting, for compliance.",
  },
  transferNumber: { es: "Transferir a un humano (número)", en: "Transfer to a human (number)" },
  transferNumberHint: {
    es: "+57 … — el agente puede pasar la llamada a este número si hace falta.",
    en: "+1 … — the agent can hand the call to this number when needed.",
  },
  connected: { es: "Conectado", en: "Connected" },
  notConnected: { es: "Sin configurar", en: "Not set up" },
  save: { es: "Guardar", en: "Save" },
  saved: { es: "Guardado", en: "Saved" },

  // ── Metrics ──
  metricsTitle: { es: "Llamadas de voz", en: "Voice calls" },
  metricTotal: { es: "Llamadas", en: "Calls" },
  metricAnswered: { es: "Contestadas", en: "Answered" },
  metricMinutes: { es: "Minutos", en: "Minutes" },
  metricCost: { es: "Costo estimado", en: "Estimated cost" },

  // ── Merchant "Voz" page ──
  agentsTitle: { es: "Agentes con voz", en: "Voice agents" },
  noAgents: {
    es: "Ningún agente tiene la voz activada.",
    en: "No agent has voice enabled.",
  },
  goToAssistant: { es: "Ir al Asistente", en: "Go to Assistant" },
  configure: { es: "Configurar", en: "Configure" },
  callLogTitle: { es: "Registro de llamadas", en: "Call log" },
  noCalls: { es: "Todavía no hay llamadas.", en: "No calls yet." },
  colContact: { es: "Contacto", en: "Contact" },
  colStatus: { es: "Estado", en: "Status" },
  colWhen: { es: "Cuándo", en: "When" },

  // ── Admin · global model stack ──
  adminTitle: { es: "Modelo de voz (global)", en: "Voice model (global)" },
  adminDesc: {
    es: "Stack de modelos que usan TODAS las cuentas. Solo el equipo de Riverz lo cambia; los merchants no lo ven.",
    en: "Model stack used by ALL accounts. Only the Riverz team changes it; merchants never see it.",
  },
  adminForbidden: {
    es: "No tienes acceso a esta sección.",
    en: "You don't have access to this section.",
  },
  adminMode: { es: "Modo de conversación", en: "Conversation mode" },
  adminModePipeline: { es: "Pipeline (STT → LLM → TTS)", en: "Pipeline (STT → LLM → TTS)" },
  adminPipelineHint: {
    es: "Máximo control y tool-calling fiable. Recomendado para pedidos/cobros.",
    en: "Maximum control and reliable tool-calling. Recommended for orders/payments.",
  },
  adminModeRealtime: { es: "Tiempo real (full-duplex)", en: "Realtime (full-duplex)" },
  adminRealtimeHint: {
    es: "Voz a voz nativa (ej. PersonaPlex): más fluida y humana. Requiere cablear el motor en el worker.",
    en: "Native speech-to-speech (e.g. PersonaPlex): more fluid and human. Requires wiring the engine in the worker.",
  },
  adminStt: { es: "Reconocimiento de voz (STT)", en: "Speech-to-text (STT)" },
  adminLlm: { es: "Cerebro (LLM)", en: "Brain (LLM)" },
  adminTts: { es: "Voz (TTS)", en: "Text-to-speech (TTS)" },
  adminRealtime: { es: "Motor full-duplex", en: "Full-duplex engine" },
  adminProvider: { es: "Proveedor", en: "Provider" },
  adminModel: { es: "Modelo", en: "Model" },
  adminLanguage: { es: "Idioma", en: "Language" },
  adminDefaultVoice: { es: "Voz por defecto", en: "Default voice" },
  adminEndpoint: { es: "Endpoint (Modal, opcional)", en: "Endpoint (Modal, optional)" },
  adminEndpointHint: {
    es: "URL OpenAI-compatible; vacío = proveedor por defecto",
    en: "OpenAI-compatible URL; empty = default provider",
  },
  advanced: { es: "Opciones avanzadas", en: "Advanced options" },
  adminApiKey: { es: "API key del endpoint", en: "Endpoint API key" },
  adminKeyEnvHint: { es: "usa la del servidor", en: "uses server key" },
  adminKeyEnvNote: {
    es: "Vacío = usa la variable de entorno del servidor para este proveedor.",
    en: "Empty = uses the server environment variable for this provider.",
  },
  adminSave: { es: "Guardar", en: "Save" },
  adminSaved: { es: "Modelo actualizado", en: "Model updated" },

  // ── COD mode (integrations · voice card) ──
  codMode: { es: "Modo confirmación COD", en: "COD confirmation mode" },
  codModeHint: {
    es: "Para dropshipping / pago contra entrega. Activa escribir el resultado en el pedido y agrupar llamadas.",
    en: "For dropshipping / cash on delivery. Enables writing the outcome to the order and grouping calls.",
  },
  orderWriteback: {
    es: "Escribir resultado en el pedido (Shopify)",
    en: "Write outcome to the order (Shopify)",
  },
  confirmedTag: { es: "Etiqueta al confirmar", en: "Tag when confirmed" },
  cancelledTag: { es: "Etiqueta al cancelar", en: "Tag when cancelled" },
  dedupeHours: { es: "Agrupar pedidos (horas)", en: "Group orders (hours)" },
  dedupeHoursHint: {
    es: "No llamar dos veces al mismo cliente en esta ventana",
    en: "Don't call the same customer twice within this window",
  },
  // ── Dropi integration card ──
  dropiDesc: {
    es: "Fulfillment COD: los pedidos confirmados por llamada pasan a despacho.",
    en: "COD fulfillment: orders confirmed by call go to dispatch.",
  },
  dropiApiKey: { es: "API key de Dropi", en: "Dropi API key" },
  dropiReplaceKey: { es: "Reemplazar API key…", en: "Replace API key…" },
  dropiBaseUrl: { es: "URL base (opcional)", en: "Base URL (optional)" },
  dropiInvalidKey: { es: "Ingresa una API key válida.", en: "Enter a valid API key." },
  dropiConnected: { es: "Dropi conectado", en: "Dropi connected" },
  dropiDisconnected: { es: "Dropi desconectado", en: "Dropi disconnected" },
  dropiConnectError: { es: "No se pudo conectar Dropi.", en: "Couldn't connect Dropi." },

  // ── Upsell (agent · order confirmation) ──
  upsellLabel: { es: "Ofrecer más unidades (upsell)", en: "Offer more units (upsell)" },
  upsellOfferPlaceholder: {
    es: "Ej: ofrece llevar 2 unidades con envío gratis.",
    en: "E.g. offer to take 2 units with free shipping.",
  },
  upsellDiscountPlaceholder: {
    es: "Descuento a mencionar (opcional)",
    en: "Discount to mention (optional)",
  },

  // ── Voice campaigns ──
  campaignsTitle: { es: "Campañas de voz", en: "Voice campaigns" },
  campaignsHint: {
    es: "Llama a un segmento de contactos con un objetivo. Respeta horario, opt-out y límites.",
    en: "Call a segment of contacts with an objective. Respects hours, opt-out and limits.",
  },
  campaignName: { es: "Nombre de la campaña", en: "Campaign name" },
  campaignPickAgent: { es: "Elige un agente…", en: "Pick an agent…" },
  campaignPickSegment: { es: "Elige un segmento…", en: "Pick a segment…" },
  campaignObjective: { es: "Objetivo de las llamadas", en: "Call objective" },
  campaignSaveDraft: { es: "Guardar borrador", en: "Save draft" },
  campaignStart: { es: "Iniciar", en: "Start" },
  campaignMissing: { es: "Completa nombre, agente y segmento.", en: "Fill in name, agent and segment." },
  campaignError: { es: "No se pudo crear la campaña.", en: "Couldn't create the campaign." },
  campaignStarted: { es: "Campaña iniciada", en: "Campaign started" },
  campaignSaved: { es: "Campaña guardada", en: "Campaign saved" },

  // ── Extra metrics ──
  metricsLast30: { es: "últimos 30 días", en: "last 30 days" },
  metricConfirmed: { es: "Confirmadas", en: "Confirmed" },
  metricUpsell: { es: "Ingreso upsell", en: "Upsell revenue" },
  metricByHour: { es: "Por hora del día", en: "By hour of day" },
  metricByCity: { es: "Por ciudad (confirmadas/total)", en: "By city (confirmed/total)" },
  metricByOutcome: { es: "Por resultado", en: "By outcome" },

  // ── Call detail (per-call drill-down) ──
  callDetail: { es: "Detalle de la llamada", en: "Call detail" },
  recording: { es: "Grabación", en: "Recording" },
  transcript: { es: "Transcripción", en: "Transcript" },
  roleAgent: { es: "Agente", en: "Agent" },
  roleCustomer: { es: "Cliente", en: "Customer" },
  attempt: { es: "Intento", en: "Attempt" },
  city: { es: "Ciudad", en: "City" },
  upsellAmount: { es: "Upsell", en: "Upsell" },
  errorLabel: { es: "Error", en: "Error" },
  openInInbox: { es: "Ver en bandeja", en: "View in inbox" },

  // ── Usage this month (voice card) ──
  usageTitle: { es: "Uso este mes", en: "This month" },
  usageMinutes: { es: "Minutos", en: "Minutes" },
  usageSpend: { es: "Gasto estimado", en: "Estimated spend" },
  usageUnlimited: { es: "Sin límite", en: "Unlimited" },

  // ── Per-objective extra instructions ──
  extraInstructions: { es: "Instrucciones extra (opcional)", en: "Extra instructions (optional)" },

  // ── Números self-serve (comprar por país) ──
  numberTitle: { es: "Número de teléfono", en: "Phone number" },
  numberDesc: {
    es: "Compra el número propio de este espacio de trabajo.",
    en: "Buy this workspace's own number.",
  },
  numberCurrent: { es: "Número actual", en: "Current number" },
  numberNone: { es: "Todavía no hay número.", en: "No number yet." },
  numberCountry: { es: "País", en: "Country" },
  numberType: { es: "Tipo", en: "Type" },
  numberTypeLocal: { es: "Local", en: "Local" },
  numberTypeTollFree: { es: "Gratuito (toll-free)", en: "Toll-free" },
  numberTypeMobile: { es: "Móvil", en: "Mobile" },
  numberTypeNational: { es: "Nacional", en: "National" },
  numberSearch: { es: "Buscar números", en: "Search numbers" },
  numberSearching: { es: "Buscando…", en: "Searching…" },
  numberNoResults: { es: "Sin números disponibles para esos filtros.", en: "No numbers available for those filters." },
  numberBuy: { es: "Comprar", en: "Buy" },
  numberBuying: { es: "Comprando…", en: "Buying…" },
  numberBought: { es: "Número comprado", en: "Number purchased" },
  numberBuyError: { es: "No se pudo comprar el número.", en: "Couldn't buy the number." },
  numberRelease: { es: "Liberar número", en: "Release number" },
  numberReleased: { es: "Número liberado", en: "Number released" },
  numberReleaseConfirm: {
    es: "¿Liberar el número? Se detiene la renta y dejará de recibir llamadas.",
    en: "Release the number? The rental stops and it will no longer receive calls.",
  },
  numberPerMonth: { es: "/mes", en: "/mo" },
  numberDocsRequired: {
    es: "Este país exige documentación para poder comprar el número:",
    en: "This country requires documentation before buying the number:",
  },
  numberDocsHint: {
    es: "Completa cada requisito y envíalo a revisión; podrás comprar cuando se apruebe.",
    en: "Complete each requirement and submit for review; you can buy once approved.",
  },
  // Regulatory submission
  numberRegSubmit: { es: "Enviar para aprobación", en: "Submit for approval" },
  numberRegSubmitting: { es: "Enviando…", en: "Submitting…" },
  numberRegError: { es: "No se pudo enviar la documentación.", en: "Couldn't submit the documentation." },
  numberRegStatusPending: { es: "Documentación en revisión", en: "Documentation under review" },
  numberRegStatusApproved: { es: "Documentación aprobada", en: "Documentation approved" },
  numberRegStatusDeclined: { es: "Documentación rechazada", en: "Documentation declined" },
  numberRegPendingHint: {
    es: "Telnyx la está revisando; vuelve más tarde para comprar.",
    en: "Telnyx is reviewing it; come back later to buy.",
  },
  numberRegApprovedHint: { es: "Ya puedes comprar el número.", en: "You can now buy the number." },
  numberUpload: { es: "Subir archivo", en: "Upload file" },
  numberUploading: { es: "Cargando…", en: "Uploading…" },
  numberUploaded: { es: "Cargado", en: "Uploaded" },
  // Address requirement fields
  numberAddrBusiness: { es: "Empresa o nombre", en: "Business or name" },
  numberAddrStreet: { es: "Dirección", en: "Street address" },
  numberAddrCity: { es: "Ciudad", en: "City" },
  numberAddrState: { es: "Estado / Provincia", en: "State / Province" },
  numberAddrPostal: { es: "Código postal", en: "Postal code" },
  numberAddrSave: { es: "Guardar dirección", en: "Save address" },
  numberAddrSaved: { es: "Dirección guardada", en: "Address saved" },
} satisfies Namespace;
