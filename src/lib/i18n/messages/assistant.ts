import type { Namespace } from "./types";

/** AI Assistant area: agents list page + the agent editor dialog. */
export const assistant = {
  emailPolicyTitle: {es:'Correo: Gmail, Outlook/Hotmail y Zoho',en:'Email: Gmail, Outlook/Hotmail and Zoho'},
  emailPolicyMode: {es:'Atención por correo',en:'Email handling'},
  emailPolicyRedirect: {es:'Redirigir a WhatsApp',en:'Redirect to WhatsApp'},
  emailPolicyAssist: {es:'Responder con el asistente',en:'Reply with the assistant'},
  emailPolicyManual: {es:'Solo atención manual',en:'Manual handling only'},
  emailPolicyPhone: {es:'WhatsApp con código de país',en:'WhatsApp with country code'},
  emailPolicyMissing: {es:'Sin un número disponible, las consultas quedan para el equipo.',en:'Without an available number, inquiries are left for the team.'},
  emailPolicyFilter: {es:'Ignorar notificaciones, publicidad y agradecimientos',en:'Ignore notifications, promotions and acknowledgements'},
  emailPolicyRepeat: {es:'No repetir la redirección en el mismo hilo',en:'Do not repeat redirects in the same thread'},
  emailPolicySave: {es:'Guardar',en:'Save'},
  emailPolicySaved: {es:'Configuración guardada',en:'Settings saved'},
  emailPolicyError: {es:'No se pudo cargar o guardar la configuración',en:'Unable to load or save settings'},
  emailPolicyInvalid: {es:'Revisa la configuración y el número de WhatsApp.',en:'Check the settings and WhatsApp number.'},
  // Dos asistentes para lo mismo no se reparten el trabajo: gana el más viejo.
  tapadoPor: {
    es: "No atiende: con este alcance contesta «{nombre}». Cambiale el alcance o apagá uno.",
    en: "Not answering: «{nombre}» covers this scope. Narrow its scope or turn one off.",
  },

  // Los casos que el asistente dejó en manos de una persona.
  escalacionesTitle: { es: "Casos para una persona", en: "Cases for a person" },
  escalacionesHint: {
    es: "Donde el asistente se plantó. Abrí el que tenga la marca roja.",
    en: "Where the assistant stopped. Open the ones flagged in red.",
  },
  escalacionesVacio: {
    es: "Ninguno quedó esperando a una persona.",
    en: "None are waiting for a person.",
  },
  escalacionesSinNombre: { es: "Sin nombre", en: "No name" },
  escalacionesOtroMotivo: { es: "Necesita una persona", en: "Needs a person" },

  // ── List page ──────────────────────────────────────────────
  pageTitle: { es: "Asistentes con IA", en: "AI assistants" },
  newAgent: { es: "Nuevo asistente", en: "New assistant" },
  createAgent: { es: "Crear asistente", en: "Create assistant" },
  emptyTitle: { es: "Tu asistente 24/7", en: "Your 24/7 assistant" },
  emptyDescription: {
    es: "Responde en todos tus canales con el contexto de cada conversación.",
    en: "Replies across every channel with the context of each conversation.",
  },

  // Card status + actions
  allChannels: { es: "Todos los canales", en: "All channels" },
  noChannelsAssigned: { es: "Sin canales asignados", en: "No channels assigned" },
  statusOnline: { es: "En línea", en: "Online" },
  statusPaused: { es: "Pausado", en: "Paused" },
  activate: { es: "Activar", en: "Activate" },
  deactivate: { es: "Desactivar", en: "Deactivate" },
  activated: { es: "Activado", en: "Activated" },
  deactivated: { es: "Desactivado", en: "Deactivated" },
  edit: { es: "Editar", en: "Edit" },
  delete: { es: "Eliminar", en: "Delete" },

  // Channel labels (comment channels — brand channels stay verbatim)
  channelFbComments: { es: "Comentarios FB", en: "FB comments" },
  channelIgComments: { es: "Comentarios IG", en: "IG comments" },
  channelTiktokComments: { es: "Comentarios TikTok", en: "TikTok comments" },
  channelWebchat: { es: "Chat web", en: "Web chat" },

  // Toasts / confirms (list page)
  loadError: { es: "No se cargaron los agentes", en: "Couldn't load agents" },
  updateError: { es: "No se pudo actualizar", en: "Couldn't update" },
  deleteConfirm: { es: '¿Eliminar "{name}"?', en: 'Delete "{name}"?' },
  deleteError: { es: "No se pudo eliminar", en: "Couldn't delete" },
  genericError: { es: "Error", en: "Error" },

  // ── Editor: header ─────────────────────────────────────────
  assistant: { es: "Asistente", en: "Assistant" },
  editorSubtitle: {
    es: "Responde automáticamente con el contexto completo de cada chat.",
    en: "Replies automatically with the full context of every chat.",
  },
  showTestPanel: { es: "Mostrar el panel de prueba", en: "Show the test panel" },
  hideTestPanel: { es: "Ocultar el panel de prueba", en: "Hide the test panel" },
  test: { es: "Probar", en: "Test" },
  hideTest: { es: "Ocultar prueba", en: "Hide test" },
  active: { es: "Activo", en: "Active" },
  paused: { es: "Pausado", en: "Paused" },
  close: { es: "Cerrar", en: "Close" },

  // Editor: tabs
  tabBusiness: { es: "Mi negocio", en: "My business" },
  tabReach: { es: "Alcance", en: "Reach" },
  tabAdvanced: { es: "Avanzado", en: "Advanced" },
  tabStats: { es: "Estadísticas", en: "Stats" },
  statsRange: { es: "Últimos 30 días", en: "Last 30 days" },
  statsActivity: { es: "Actividad", en: "Activity" },
  statsSent: { es: "Respuestas enviadas", en: "Replies sent" },
  statsConversations: { es: "Conversaciones", en: "Conversations" },
  statsSkipped: { es: "Omitidas", en: "Skipped" },
  statsResults: { es: "Resultados", en: "Results" },
  statsCalls: { es: "Llamadas", en: "Calls" },
  statsConfirmed: { es: "Confirmadas", en: "Confirmed" },
  statsCost: { es: "Costo / uso", en: "Cost / usage" },
  statsTokens: { es: "Tokens", en: "Tokens" },
  statsEmpty: { es: "Sin datos todavía.", en: "No data yet." },

  // ── Editor: business tab — product ─────────────────────────
  productFieldNew: {
    es: "Producto que vende este asistente",
    en: "Product this assistant sells",
  },
  productFieldEdit: {
    es: "¿Sobre qué productos puede hablar?",
    en: "Which products can it talk about?",
  },
  preparingWithProduct: {
    es: "Preparando el asistente con tu producto…",
    en: "Setting up the assistant with your product…",
  },
  productNewHint: {
    es: "Elígelo y armamos solos el resto (nombre, tono, persona y conocimiento). Puedes asignar varios.",
    en: "Pick it and we'll build the rest (name, tone, persona, and knowledge). You can assign more than one.",
  },
  wholeCatalog: { es: "Todo el catálogo", en: "Whole catalog" },
  someProducts: { es: "Solo algunos", en: "Only some" },
  searchProduct: { es: "Buscar producto…", en: "Search product…" },
  noProductsYet: {
    es: "Todavía no tienes productos. Crea uno y el asistente aprenderá de él.",
    en: "You don't have any products yet. Create one and the assistant will learn from it.",
  },
  createNewProduct: { es: "Crear producto nuevo", en: "Create new product" },
  noResults: { es: "Sin resultados.", en: "No results." },
  assign: { es: "Asignar", en: "Assign" },
  assigned: { es: "Asignado", en: "Assigned" },
  productsAssignedOne: { es: "{count} producto asignado.", en: "{count} product assigned." },
  productsAssignedOther: {
    es: "{count} productos asignados.",
    en: "{count} products assigned.",
  },
  notListedCreate: { es: "¿No está? Crear producto nuevo", en: "Not here? Create a new product" },
  // Sin ningún producto asignado el agente no puede nombrar, cotizar ni buscar
  // nada del catálogo. Sin este aviso pasa callado.
  scopeSpecificEmpty: {
    es: "Sin productos asignados no va a poder hablar de ninguno. Asigna al menos uno o cambia a todo el catálogo.",
    en: "With no products assigned it won't be able to talk about any. Assign at least one or switch to the whole catalog.",
  },

  // Editor: business tab — identity
  identityTitle: { es: "Identidad del asistente", en: "Assistant identity" },
  agentNameLabel: { es: "Nombre del asistente", en: "Assistant name" },
  toneLabel: { es: "Tono", en: "Tone" },
  toneHelp: {
    es: 'Ajusta sutilmente el estilo. El detalle de la personalidad va en "Cómo se presenta y actúa".',
    en: 'Subtly adjusts the style. The personality detail lives in "How it introduces itself and acts".',
  },
  languageLabel: { es: "Idioma", en: "Language" },

  // Tones
  toneFriendly: { es: "Cercano", en: "Friendly" },
  toneFriendlyHint: {
    es: "Cálido, conversacional, frases cortas.",
    en: "Warm, conversational, short sentences.",
  },
  toneFormal: { es: "Formal", en: "Formal" },
  toneFormalHint: { es: "Profesional, distancia respetuosa.", en: "Professional, respectful distance." },
  toneCasual: { es: "Coloquial", en: "Casual" },
  toneCasualHint: { es: "Directo, modismos suaves.", en: "Direct, light slang." },
  toneConcise: { es: "Breve", en: "Concise" },
  toneConciseHint: { es: "Una o dos frases, sin rodeos.", en: "One or two sentences, no fluff." },

  // Languages
  languageSpanish: { es: "Español", en: "Spanish" },
  languageEnglish: { es: "Inglés", en: "English" },
  languagePortuguese: { es: "Portugués", en: "Portuguese" },
  languageFrench: { es: "Francés", en: "French" },

  // Editor: business tab — persona + knowledge
  personaTitle: { es: "Cómo se presenta y actúa", en: "How it introduces itself and acts" },
  personaHint: {
    es: "Edítalo solo para afinar reglas o tono.",
    en: "Edit it only to fine-tune rules or tone.",
  },
  editAdvanced: { es: "Editar avanzado", en: "Advanced edit" },
  personaEmpty: {
    es: 'Se completa al elegir tu producto. O toca "Editar avanzado".',
    en: 'Filled in when you pick your product. Or tap "Advanced edit".',
  },
  // Placeholders (greyed example text shown in empty inputs)
  agentNamePlaceholder: { es: "Pili", en: "Pili" },
  personaPlaceholder: {
    es: "Eres Pili, asesora de la marca. Atiendes con calidez, una pregunta por turno, nunca admites ser IA.",
    en: "You are Pili, a brand advisor. You reply warmly, one question per turn, and never admit to being an AI.",
  },
  shopDomainPlaceholder: { es: "tu-tienda.myshopify.com", en: "your-store.myshopify.com" },
  businessInfoTitle: { es: "Información del negocio", en: "Business information" },
  businessInfoHint: {
    es: "Envíos, políticas, horarios. Opcional.",
    en: "Shipping, policies, hours. Optional.",
  },
  businessInfoPlaceholder: {
    es: "Envíos en 2 días hábiles a todo el país.\nDevoluciones dentro de 15 días.\nPagos: tarjeta, PSE, contraentrega.",
    en: "Nationwide shipping in 2 business days.\nReturns within 15 days.\nPayments: card, bank transfer, cash on delivery.",
  },
  idealCustomer: { es: "Cliente ideal: {value}", en: "Ideal customer: {value}" },
  keyBenefits: { es: "Beneficios clave: {value}", en: "Key benefits: {value}" },
  defaultAgentName: { es: "Asesor de {title}", en: "{title} advisor" },

  // Prefill toasts
  assistantReady: { es: "Asistente preparado con tu producto.", en: "Assistant set up with your product." },
  productAssigned: { es: "Producto asignado.", en: "Product assigned." },
  productAssignedHint: {
    es: "Para mejores respuestas, genera su investigación en Productos.",
    en: "For better answers, generate its research in Products.",
  },

  // ── Editor: reach tab ──────────────────────────────────────
  channelsFieldLabel: { es: "¿En qué canales responde?", en: "Which channels does it reply on?" },
  someChannels: { es: "Solo algunos", en: "Only some" },
  channelsRequired: {
    es: "Elige al menos un canal.",
    en: "Choose at least one channel.",
  },
  responseRulesLabel: { es: "Reglas de respuesta", en: "Response rules" },
  replyWhenAssignedTitle: {
    es: "Responder aunque haya agente asignado",
    en: "Reply even when an agent is assigned",
  },
  replyWhenAssignedHint: {
    es: "Si un humano está atendiendo, por defecto la IA calla.",
    en: "If a human is handling it, the AI stays quiet by default.",
  },
  businessHoursTitle: { es: "Horario de atención", en: "Business hours" },
  businessHoursHint: {
    es: "Si lo activas, solo responde dentro de la ventana. Si no, 24/7.",
    en: "When on, it only replies within the window. Otherwise, 24/7.",
  },
  hoursOvernight: {
    es: "Turno noche: sigue hasta esa hora del día siguiente.",
    en: "Overnight: runs until that time the next day.",
  },
  startLabel: { es: "Inicio", en: "Start" },
  endLabel: { es: "Fin", en: "End" },
  timezoneLabel: { es: "Zona horaria", en: "Time zone" },
  daysLabel: { es: "Días", en: "Days" },
  escalateKeywordsLabel: {
    es: "Pasar a un humano si el mensaje contiene…",
    en: "Hand off to a human if the message contains…",
  },
  escalateKeywordsPlaceholder: { es: "humano, reembolso…", en: "human, refund…" },

  // Time zones (offset stays in the translation; city changes per language)
  tzBogota: { es: "Bogotá (UTC-5)", en: "Bogotá (UTC-5)" },
  tzMexicoCity: { es: "Ciudad de México (UTC-6)", en: "Mexico City (UTC-6)" },
  tzLima: { es: "Lima (UTC-5)", en: "Lima (UTC-5)" },
  tzSantiago: { es: "Santiago (UTC-4)", en: "Santiago (UTC-4)" },
  tzBuenosAires: { es: "Buenos Aires (UTC-3)", en: "Buenos Aires (UTC-3)" },
  tzCaracas: { es: "Caracas (UTC-4)", en: "Caracas (UTC-4)" },
  tzQuito: { es: "Quito (UTC-5)", en: "Quito (UTC-5)" },
  tzLaPaz: { es: "La Paz (UTC-4)", en: "La Paz (UTC-4)" },
  tzAsuncion: { es: "Asunción (UTC-3)", en: "Asunción (UTC-3)" },
  tzMontevideo: { es: "Montevideo (UTC-3)", en: "Montevideo (UTC-3)" },
  tzSaoPaulo: { es: "São Paulo (UTC-3)", en: "São Paulo (UTC-3)" },
  tzPanama: { es: "Panamá (UTC-5)", en: "Panama (UTC-5)" },
  tzSanJose: { es: "San José (UTC-6)", en: "San José (UTC-6)" },
  tzGuatemala: { es: "Guatemala (UTC-6)", en: "Guatemala (UTC-6)" },
  tzSanSalvador: { es: "San Salvador (UTC-6)", en: "San Salvador (UTC-6)" },
  tzTegucigalpa: { es: "Tegucigalpa (UTC-6)", en: "Tegucigalpa (UTC-6)" },
  tzManagua: { es: "Managua (UTC-6)", en: "Managua (UTC-6)" },
  tzSantoDomingo: { es: "Santo Domingo (UTC-4)", en: "Santo Domingo (UTC-4)" },
  tzHavana: { es: "La Habana (UTC-5)", en: "Havana (UTC-5)" },
  tzSanJuan: { es: "San Juan (UTC-4)", en: "San Juan (UTC-4)" },

  // Week days
  dayMonShort: { es: "Lun", en: "Mon" },
  dayMonLong: { es: "Lunes", en: "Monday" },
  dayTueShort: { es: "Mar", en: "Tue" },
  dayTueLong: { es: "Martes", en: "Tuesday" },
  dayWedShort: { es: "Mié", en: "Wed" },
  dayWedLong: { es: "Miércoles", en: "Wednesday" },
  dayThuShort: { es: "Jue", en: "Thu" },
  dayThuLong: { es: "Jueves", en: "Thursday" },
  dayFriShort: { es: "Vie", en: "Fri" },
  dayFriLong: { es: "Viernes", en: "Friday" },
  daySatShort: { es: "Sáb", en: "Sat" },
  daySatLong: { es: "Sábado", en: "Saturday" },
  daySunShort: { es: "Dom", en: "Sun" },
  daySunLong: { es: "Domingo", en: "Sunday" },

  // ── Editor: advanced tab ───────────────────────────────────
  responseBehaviorTitle: { es: "Comportamiento de respuesta", en: "Response behavior" },
  autonomyLabel: { es: "Autonomía", en: "Autonomy" },
  autonomyAuto: { es: "Responde solo", en: "Replies on its own" },
  autonomyAutoHint: {
    es: "Envía la respuesta al cliente sin esperar a nadie.",
    en: "Sends the reply to the customer without waiting for anyone.",
  },
  autonomyApproval: { es: "Aprobar cada mensaje", en: "Approve every message" },
  autonomyApprovalHint: {
    es: "Deja la respuesta lista en la bandeja y sale con un clic.",
    en: "Leaves the reply ready in the inbox; one click sends it.",
  },
  responseModeLabel: { es: "Modo de respuesta", en: "Response mode" },
  responseModeSingle: { es: "Un solo mensaje", en: "Single message" },
  responseModeSingleHint: { es: "Una respuesta completa por turno.", en: "One complete reply per turn." },
  responseModeMulti: { es: "Varios mensajes cortos", en: "Several short messages" },
  responseModeMultiHint: {
    es: "Parte la respuesta en mensajes naturales.",
    en: "Splits the reply into natural messages.",
  },
  responseModeDynamic: { es: "Dinámico", en: "Dynamic" },
  responseModeDynamicHint: {
    es: "El asistente decide según el contenido.",
    en: "The assistant decides based on the content.",
  },
  debounceLabel: {
    es: "Esperar antes de responder (segundos)",
    en: "Wait before replying (seconds)",
  },
  debounceHelp: {
    es: "Por si la clienta sigue escribiendo. Recomendado: 15s.",
    en: "In case the customer is still typing. Recommended: 15s.",
  },
  burstLabel: {
    es: "Tope de respuestas por hora a la misma persona",
    en: "Cap on replies per hour to the same person",
  },
  burstHelp: {
    es: "El freno por si algo entra en bucle. Al llegar al tope, ese chat pasa a una persona.",
    en: "The brake in case something loops. On reaching the cap, that chat goes to a person.",
  },
  burstOff: {
    es: "Sin tope. Si algo entra en bucle, nada lo va a frenar.",
    en: "No cap. If something loops, nothing will stop it.",
  },
  escalationTitle: { es: "Escalamiento", en: "Escalation" },
  escalationHint: {
    es: "Cuándo pasar la conversación a un agente humano.",
    en: "When to hand the conversation to a human agent.",
  },
  escalateAfterLabel: {
    es: "Escalar a humano después de N mensajes",
    en: "Escalate to a human after N messages",
  },
  escalateAfterHelp: { es: "0 desactiva la regla.", en: "0 turns the rule off." },

  // Advanced: follow-ups
  followupTitle: { es: "Seguimiento automático", en: "Automatic follow-up" },
  followupHint: {
    es: "Si el cliente deja de responder, el asistente le escribe un seguimiento contextual según la conversación.",
    en: "If the customer stops replying, the assistant sends a contextual follow-up based on the conversation.",
  },
  followupDelayLabel: { es: "Horas de espera", en: "Hours to wait" },
  followupDelayHelp: {
    es: "Máx. 23 h: Meta solo deja escribir dentro de las 24 h del último mensaje del cliente.",
    en: "Max 23h: Meta only allows messages within 24h of the customer's last one.",
  },
  followupMaxLabel: { es: "Máximo de seguimientos", en: "Maximum follow-ups" },
  followupMaxHelp: {
    es: "Por racha de silencio. Se reinicia cuando responde.",
    en: "Per silence streak. Resets when they reply.",
  },
  followupFootnote: {
    es: 'Respeta el horario de atención y "no responder con agente asignado". Solo aplica a WhatsApp, Instagram y Messenger.',
    en: 'Respects business hours and "don\'t reply when an agent is assigned". Only applies to WhatsApp, Instagram, and Messenger.',
  },

  // Proactive Instagram DM automation level (Ventas por Instagram)
  proactiveModeTitle: {
    es: "DMs proactivos de Instagram",
    en: "Proactive Instagram DMs",
  },
  proactiveModeHint: {
    es: "Cuánto sale solo por Instagram (comentario→DM y campañas). Siempre dentro de las políticas de Meta.",
    en: "How much of the Instagram outreach (comment→DM and campaigns) goes out on its own. Always within Meta policy.",
  },
  proactiveModeAuto: {
    es: "Automático: envía solo (con opt-out y ventana de 24 h)",
    en: "Automatic: send on its own (with opt-out and 24h window)",
  },
  proactiveModeHybrid: {
    es: "Híbrido: auto para alta intención, el resto a revisión",
    en: "Hybrid: auto for high intent, the rest to review",
  },
  proactiveModeApproval: {
    es: "Aprobación: cada DM espera tu visto bueno",
    en: "Approval: every DM waits for your go-ahead",
  },
  proactiveModeFootnote: {
    es: "Los DMs en revisión aparecen en Ventas por Instagram para aprobarlos o editarlos antes de enviar.",
    en: "DMs awaiting review appear in Instagram Sales to approve or edit before sending.",
  },

  // Advanced: sales close
  salesCloseTitle: { es: "Cierre de ventas", en: "Sales closing" },
  salesCloseHint: {
    es: "Arma el pedido con el cliente y lo crea en Shopify. Apagado, el cierre queda para tu equipo.",
    en: "Builds the order with the customer and creates it in Shopify. Off, the close is left to your team.",
  },
  connectShopifyFirst: {
    es: "Primero conecta Shopify para activar el cierre de ventas.",
    en: "Connect Shopify first to enable sales closing.",
  },
  salesCloseConnectPrompt: {
    es: "Para crear pedidos necesita Shopify conectado.",
    en: "Creating orders needs Shopify connected.",
  },
  connect: { es: "Conectar", en: "Connect" },
  cancel: { es: "Cancelar", en: "Cancel" },
  linkShopify: { es: "Vincular Shopify", en: "Link Shopify" },
  linkingHint: {
    es: "Completa la conexión en la ventana emergente… se activa solo al terminar.",
    en: "Finish the connection in the pop-up… it turns on automatically when done.",
  },

  // Advanced: API key
  apiKeyTitle: { es: "Clave propia de IA", en: "Your own AI key" },
  apiKeyLabel: { es: "API key de Anthropic", en: "Anthropic API key" },
  apiKeyPlaceholderSaved: {
    es: "••••••••  (ya hay una key guardada)",
    en: "••••••••  (a key is already saved)",
  },
  apiKeyHelp: {
    es: "Obligatoria en BYOK; opcional en otros planes. Se guarda cifrada. Déjala vacía para conservar la actual.",
    en: "Required for BYOK; optional for other plans. Stored encrypted. Leave blank to keep the current key.",
  },

  // ── Editor: test panel ─────────────────────────────────────
  testPanelTitle: { es: "Probar el asistente", en: "Test the assistant" },
  testPanelSubtitle: {
    es: "Conversa con el bot como si fueras un cliente.",
    en: "Chat with the bot as if you were a customer.",
  },
  resetConversation: { es: "Reiniciar conversación", en: "Reset conversation" },
  reset: { es: "Reiniciar", en: "Reset" },
  testEmptyPrompt: { es: "Escribe un mensaje para empezar.", en: "Type a message to start." },
  you: { es: "Tú", en: "You" },
  noReply: { es: "Sin respuesta.", en: "No reply." },
  saveBeforeTestHint: {
    es: "Guarda el asistente antes de probarlo.",
    en: "Save the assistant before testing it.",
  },
  testInputPlaceholder: {
    es: "Hola, ¿tienen envío a Bogotá?",
    en: "Hi, do you ship to Bogotá?",
  },
  send: { es: "Enviar", en: "Send" },

  // ── Editor: footer + save flow ─────────────────────────────
  save: { es: "Guardar", en: "Save" },
  saveBeforeTest: { es: "Guarda primero para probar.", en: "Save first to test." },
  testFailed: { es: "Falló", en: "Failed" },

  // Save validation + result toasts
  nameRequired: { es: "Falta el nombre", en: "Name is required" },
  productRequired: {
    es: "Elige al menos un producto para crear el asistente.",
    en: "Choose at least one product to create the assistant.",
  },
  debounceRange: {
    es: "La espera debe estar entre 5 y 60 segundos",
    en: "The wait must be between 5 and 60 seconds",
  },
  escalateNegative: {
    es: "El escalamiento no puede ser negativo",
    en: "Escalation can't be negative",
  },
  followupDelayInvalid: {
    es: "Las horas de espera del seguimiento deben ser mayores a 0",
    en: "Follow-up wait hours must be greater than 0",
  },
  followupCountInvalid: {
    es: "El seguimiento necesita al menos 1 mensaje",
    en: "Follow-up needs at least 1 message",
  },
  // `hoursStartBeforeEnd` se eliminó: fin <= inicio ya no es un error, es
  // turno noche (22:00 → 02:00). Ahora se explica con `hoursOvernight`.
  hoursDayRequired: {
    es: "Elige al menos un día del horario",
    en: "Choose at least one day for the schedule",
  },
  saveError: { es: "No se pudo guardar", en: "Couldn't save" },
  savedToast: { es: "Guardado", en: "Saved" },
  createdToast: { es: "Asistente creado", en: "Assistant created" },

  // Shopify link (editor)
  shopDomainRequired: {
    es: "Escribe el dominio de tu tienda (tu-tienda.myshopify.com).",
    en: "Enter your store domain (your-store.myshopify.com).",
  },
  shopifyConnectedToast: {
    es: "Shopify conectado. Ya puedes activar el cierre de ventas.",
    en: "Shopify connected. You can now enable sales closing.",
  },
  // El aviso por WhatsApp cuando un caso queda en manos de una persona.
  avisoDestino: {
    es: "Los casos urgentes se avisan por WhatsApp al",
    en: "Urgent cases are sent by WhatsApp to",
  },
  avisoSinDestino: {
    es: "Nadie recibe los avisos: conecta un WhatsApp o carga tu teléfono en el perfil.",
    en: "No one receives the alerts: connect a WhatsApp number or add your phone to your profile.",
  },
  avisoProbar: { es: "Probar", en: "Send a test" },
  avisoEnviado: { es: "Aviso enviado", en: "Alert sent" },
  avisoPruebaTitulo: {
    es: "Prueba de aviso de Riverz",
    en: "Riverz alert test",
  },
  avisoPruebaCuerpo: {
    es: "Si lees esto, los casos que el asistente deje en manos de una persona van a llegar a este número.",
    en: "If you can read this, the cases the assistant hands to a person will reach this number.",
  },
  // Probar el comercio entero como cliente: escenario + canal, sin elegir agente.
  probarTitle: { es: "Probar como cliente", en: "Test as a customer" },
  probarHint: {
    es: "Elige una situación y escribe como si fueras el cliente.",
    en: "Pick a situation and write as if you were the customer.",
  },
  probarHoy: { es: "Hoy", en: "Today" },
  probarEscenario: { es: "Situación", en: "Situation" },
  probarCanal: { es: "Canal", en: "Channel" },
  probarPago: { es: "Pago", en: "Payment" },
  probarPagoTarjeta: { es: "Tarjeta", en: "Card" },
  probarPagoPendiente: { es: "Pendiente de pago", en: "Payment pending" },
  probarPrimeroEspera: { es: "El primer mensaje sale en {n} {unit}", en: "The first message goes out in {n} {unit}" },
  probarEnviar: { es: "Enviar", en: "Send" },
  probarCompartir: { es: "Link de prueba", en: "Test link" },
  probarCompartirHint: {
    es: "Quien lo abra prueba como cliente sin entrar a Riverz. Vence en 30 días.",
    en: "Anyone who opens it tests as a customer without signing in. Expires in 30 days.",
  },
  probarCopiarLink: { es: "Copiar link", en: "Copy link" },
  probarLinkCopiado: { es: "Link copiado", en: "Link copied" },
  probarAbrirLink: { es: "Abrir", en: "Open" },
  probarLinkInvalido: {
    es: "Este link de prueba venció o no es válido. Pide uno nuevo.",
    en: "This test link expired or is not valid. Ask for a new one.",
  },
  probarPaginaTitulo: { es: "Prueba {comercio} como cliente", en: "Test {comercio} as a customer" },
  // Feedback de conversaciones reales y de pruebas.
  feedbackTitulo: { es: "Feedback", en: "Feedback" },
  feedbackHint: {
    es: "Lo que tu equipo marcó en las respuestas automáticas. Se convierte en reglas del asistente.",
    en: "What your team marked on automatic replies. It turns into assistant rules.",
  },
  feedbackReales: { es: "Conversaciones", en: "Conversations" },
  feedbackPruebas: { es: "Pruebas", en: "Tests" },
  feedbackAutomaticas: { es: "Aplicar mejoras solas", en: "Apply improvements automatically" },
  feedbackAutomaticasHint: {
    es: "El feedback nuevo se convierte en reglas y se aplica solo cada 15 minutos.",
    en: "New feedback becomes rules and is applied on its own every 15 minutes.",
  },
  feedbackVacio: {
    es: "Todavía no hay feedback. Comenta las respuestas automáticas desde la bandeja.",
    en: "No feedback yet. Comment on automatic replies from the inbox.",
  },
  feedbackNuevos: { es: "{n} sin revisar", en: "{n} not reviewed" },
  feedbackEstadoNuevo: { es: "Nuevo", en: "New" },
  feedbackEstadoUsado: { es: "Revisado", en: "Reviewed" },
  feedbackAplicadaSola: { es: "Aplicada sola", en: "Applied automatically" },
  // Piloto en vivo: todo funcionando de verdad, con límites o sólo para ciertos números.
  pilotoTitulo: { es: "Piloto en vivo", en: "Live pilot" },
  pilotoHint: {
    es: "Pon a prueba todo lo armado con clientes reales, con un tope de respuestas o sólo para tu número.",
    en: "Try everything you built with real customers, with a reply cap or only for your number.",
  },
  pilotoEstado_borrador: { es: "Sin iniciar", en: "Not started" },
  pilotoEstado_activo: { es: "En curso", en: "Running" },
  pilotoEstado_agotado: { es: "Llegó al límite", en: "Limit reached" },
  pilotoEstado_terminado: { es: "Terminado", en: "Finished" },
  pilotoDesde: { es: "desde {fecha}", en: "since {fecha}" },
  pilotoAgotado: {
    es: "La IA y las automatizaciones están en pausa hasta pasar a producción.",
    en: "AI and automations are paused until you go live.",
  },
  pilotoMensajes: { es: "Respuestas a mensajes", en: "Message replies" },
  pilotoComentarios: { es: "Respuestas a comentarios", en: "Comment replies" },
  pilotoAutomatizaciones: { es: "Automatizaciones que arrancan", en: "Automations started" },
  pilotoIaPausada: {
    es: "La IA está en pausa (pago, saldo o suscripción)",
    en: "AI is paused (payment, balance or subscription)",
  },
  pilotoGuardarCambios: { es: "Guardar cambios", en: "Save changes" },
  pilotoSinTope: { es: "sin tope", en: "no cap" },
  pilotoIniciar: { es: "Iniciar piloto", en: "Start pilot" },
  pilotoIniciarConfirm: {
    es: "Desde ahora las respuestas y automatizaciones salen de verdad, hasta el límite que pusiste. Después prende los asistentes y automatizaciones que quieras probar.",
    en: "From now on replies and automations go out for real, up to the limit you set. Then turn on the assistants and automations you want to try.",
  },
  pilotoProduccion: { es: "Pasar a producción", en: "Go live" },
  pilotoProduccionConfirm: {
    es: "Termina el piloto: todo sigue funcionando sin límites y para todos los clientes.",
    en: "Ends the pilot: everything keeps running with no caps, for every customer.",
  },
  pilotoDescartar: { es: "Descartar", en: "Discard" },
  pilotoGuardar: { es: "Guardar sin iniciar", en: "Save without starting" },
  pilotoGuardado: { es: "Piloto guardado", en: "Pilot saved" },
  pilotoMotor: { es: "La operación está encendida", en: "Operation is on" },
  pilotoCanales: { es: "Canales", en: "Channels" },
  pilotoTodos: { es: "Todos", en: "All" },
  pilotoSinPagarSinTecho: {
    es: "Sin pagar, el piloto necesita números o un límite",
    en: "Without payment, the pilot needs numbers or a limit",
  },
  pilotoNumerosPlaceholder: { es: "Todos. Uno por línea: +54 9 11 5555 5555", en: "Everyone. One per line: +54 9 11 5555 5555" },
  pilotoMotorApagado: { es: "La operación está apagada", en: "Operation is off" },
  pilotoSinAsistentes: { es: "No hay asistentes activos", en: "No active assistants" },
  pilotoSinAutomatizaciones: { es: "No hay automatizaciones activas", en: "No active automations" },
  pilotoLimitesHint: {
    es: "0 = no responde durante el piloto.",
    en: "0 = doesn't reply during the pilot.",
  },
  pilotoNumeros: { es: "Sólo estos números", en: "Only these numbers" },
  // Pruebas guardadas: cada prueba es un chat, con feedback que se vuelve reglas.
  pruebasProbar: { es: "Probar", en: "Test" },
  pruebasGuardadas: { es: "Pruebas guardadas", en: "Saved tests" },
  pruebasVacio: {
    es: "Todavía no hay pruebas. Cada vez que empiezas o reinicias una, se guarda aquí.",
    en: "No tests yet. Each time you start or restart one, it's saved here.",
  },
  pruebasElegir: { es: "Elige una prueba para verla.", en: "Pick a test to view it." },
  pruebasPorLink: { es: "Por link", en: "Via link" },
  pruebasConPropuestas: { es: "Con propuestas", en: "With proposals" },
  pruebasComentar: { es: "Comentar", en: "Comment" },
  pruebasNotaPlaceholder: { es: "¿Qué debería responder?", en: "What should it reply?" },
  pruebasComentarioGeneral: { es: "Comentario sobre la prueba", en: "Comment on this test" },
  pruebasComentarioPlaceholder: {
    es: "Qué cambiarías en general: tono, largo, datos, pasos…",
    en: "What you'd change overall: tone, length, facts, steps…",
  },
  pruebasListo: { es: "Listo", en: "Done" },
  pruebasMejoras: { es: "Mejoras", en: "Improvements" },
  probarAbrirConLink: { es: "Abrir con link", en: "Open with link" },
  pruebasBorrar: { es: "Eliminar prueba", en: "Delete test" },
  pruebasBorrarTodas: { es: "Eliminar todas", en: "Delete all" },
  pruebasBorrarTodasTitulo: { es: "¿Eliminar las {n} pruebas?", en: "Delete all {n} tests?" },
  pruebasBorrarAviso: { es: "No se puede deshacer.", en: "This can't be undone." },
  pruebasBorradas: { es: "Pruebas eliminadas", en: "Tests deleted" },
  pruebasEnRevision: { es: "En revisión", en: "Under review" },
  pruebasSinMejoras: {
    es: "Todavía no hay mejoras. El equipo de Riverz las revisa y las aplica.",
    en: "No improvements yet. The Riverz team reviews and applies them.",
  },
  pruebasProponer: { es: "Proponer mejoras", en: "Suggest improvements" },
  pruebasProponerOtraVez: { es: "Proponer de nuevo", en: "Suggest again" },
  pruebasSinFeedback: {
    es: "Comenta una respuesta o la prueba entera para proponer mejoras.",
    en: "Comment on a reply or the whole test to suggest improvements.",
  },
  pruebasSinCambios: {
    es: "Lo marcado ya está cubierto por las reglas actuales.",
    en: "What you marked is already covered by the current rules.",
  },
  pruebasReglaNueva: { es: "Regla nueva", en: "New rule" },
  pruebasReglaEditada: { es: "Edita una regla", en: "Edits a rule" },
  pruebasTodosLosAsistentes: { es: "Todos los asistentes", en: "All assistants" },
  pruebasAplicar: { es: "Aplicar", en: "Apply" },
  pruebasAplicada: { es: "Aplicada", en: "Applied" },
  pruebasParaPlataforma: { es: "Lo revisa el equipo de Riverz", en: "The Riverz team reviews it" },
  pruebasReglaNoExiste: {
    es: "Esa regla ya no existe. Propón de nuevo.",
    en: "That rule no longer exists. Suggest again.",
  },
  pruebasTopeReglas: {
    es: "Ese asistente ya tiene {n} reglas, el máximo. Edita o apaga una antes.",
    en: "That assistant already has {n} rules, the maximum. Edit or turn one off first.",
  },
  probarEscMensaje: { es: "El cliente escribe primero", en: "The customer writes first" },
  probarEscPedido: { es: "Compra en la tienda", en: "Buys in the store" },
  probarEscCarrito: { es: "Deja el carrito", en: "Abandons the cart" },
  probarEscDespachado: { es: "Se despacha su pedido", en: "Their order ships" },
  probarEscEntregado: { es: "Le entregan el pedido", en: "Their order is delivered" },
  probarEscCancelado: { es: "Se cancela su pedido", en: "Their order is cancelled" },
  probarProducto: { es: "Producto", en: "Product" },
  probarPagoCod: { es: "Contra entrega", en: "Cash on delivery" },
  probarGuia: { es: "Número de guía", en: "Tracking number" },
  probarGuiaHint: { es: "Vacío = la tienda despacha sin guía", en: "Empty = the store ships without tracking" },
  probarTelefono: { es: "Teléfono del cliente (opcional)", en: "Customer phone (optional)" },
  probarTelefonoHint: {
    es: "Con un teléfono real el asistente puede buscar sus pedidos de verdad.",
    en: "With a real phone the assistant can look up their actual orders.",
  },
  probarSinAutomatizaciones: {
    es: "Ninguna automatización activa reacciona a esto. El cliente no recibe nada solo.",
    en: "No active automation reacts to this. The customer receives nothing on its own.",
  },
  probarLlamada: { es: "Llamada de «{agente}»", en: "Call from «{agente}»" },
  probarSinAgente: {
    es: "Ningún asistente activo atiende este canal. El cliente no recibe respuesta.",
    en: "No active assistant covers this channel. The customer gets no reply.",
  },
  probarAsignadoInactivo: {
    es: "El asistente al que la automatización entrega la conversación está apagado: nadie contesta.",
    en: "The assistant the automation hands over to is off: nobody replies.",
  },
  probarEscribi: { es: "Escribe como el cliente…", en: "Type as the customer…" },
  probarEmpezar: { es: "Empezar", en: "Start" },
  probarEscPagoRechazado: { es: "Se le rechaza el pago", en: "Their payment is rejected" },
  probarBarreraBaja: {
    es: "Pidió la baja: se le manda el acuse y ningún asistente le escribe más.",
    en: "They opted out: the acknowledgement is sent and no assistant writes again.",
  },
  probarBarreraAlta: {
    es: "Pidió volver a recibir mensajes: se le manda el acuse.",
    en: "They opted back in: the acknowledgement is sent.",
  },
  probarBarreraContestador: {
    es: "Eso es el contestador automático del cliente: se guarda y no se contesta.",
    en: "That is the customer's auto-reply: stored, not answered.",
  },
  probarBarreraPersona: {
    es: "Pide una persona: el asistente no contesta, el caso queda marcado y el comercio recibe aviso. {detalle}",
    en: "Asks for a person: the assistant stays quiet, the case is flagged and the store is notified. {detalle}",
  },
  probarBarreraProblema: {
    es: "Problema detectado, va a una persona: {detalle}. El asistente no contesta y el comercio recibe aviso.",
    en: "Problem detected, goes to a person: {detalle}. The assistant stays quiet and the store is notified.",
  },
  probarBarreraTope: {
    es: "El asistente ya contestó {n} veces en este hilo: se calla y deja el caso a una persona.",
    en: "The assistant already replied {n} times in this thread: it steps back for a person.",
  },
  probarBarreraPrecio: {
    es: "La respuesta citaba un importe que no es un precio autorizado ({detalle}): no sale y el caso pasa a una persona.",
    en: "The reply quoted an amount that is not an authorized price ({detalle}): it is not sent and the case goes to a person.",
  },
  probarBarreraProhibida: {
    es: "La respuesta afirmaba algo que el comercio prohibió ({detalle}): no sale y el caso pasa a una persona.",
    en: "The reply claimed something the store forbids ({detalle}): it is not sent and the case goes to a person.",
  },
  probarEnLinea: { es: "en línea", en: "online" },
  probarPasaron: { es: "Pasaron {n} {unit}", en: "{n} {unit} went by" },
  probarTraspaso: { es: "Pasa a una persona del equipo: {motivo}", en: "Handed to a team member: {motivo}" },
  probarLaSiguePersona: {
    es: "La sigue una persona del equipo: el asistente ya no contesta",
    en: "A team member takes it from here: the assistant no longer replies",
  },
  probarSegundo: { es: "segundo", en: "second" },
  probarSegundos: { es: "segundos", en: "seconds" },
  probarMinuto: { es: "minuto", en: "minute" },
  probarMinutos: { es: "minutos", en: "minutes" },
  probarHora: { es: "hora", en: "hour" },
  probarHoras: { es: "horas", en: "hours" },
  probarDia: { es: "día", en: "day" },
  probarDias: { es: "días", en: "days" },
  probarReiniciar: { es: "Empezar de nuevo", en: "Start over" },
  probarFallo: { es: "No se pudo simular", en: "Couldn't simulate" },
  probarComentarioPublico: { es: "Respuesta pública en el comentario", en: "Public reply on the comment" },
  probarComentarioPrivado: { es: "Mensaje privado", en: "Private message" },
  probarComentarioOcultoCritica: {
    es: "En vivo este comentario se oculta y no se contesta: es una crítica a la marca.",
    en: "Live, this comment is hidden and not answered: it criticizes the brand.",
  },
  probarComentarioOcultoSpam: {
    es: "En vivo este comentario se oculta y no se contesta: es spam.",
    en: "Live, this comment is hidden and not answered: it is spam.",
  },
  probarComentarioEscala: {
    es: "Además queda marcado para una persona del equipo ({motivo}).",
    en: "It is also flagged for a team member ({motivo}).",
  },
  probarEscalaPedido: { es: "pregunta por un pedido", en: "asks about an order" },
  probarEscalaReclamo: { es: "es un reclamo", en: "it's a complaint" },
  probarEscalaPago: { es: "habla de pagar por fuera de la caja", en: "mentions paying outside checkout" },
  probarComentarioAprobacion: {
    es: "Con «Aprobar cada mensaje» la respuesta queda propuesta hasta que alguien la aprueba.",
    en: "With «Approve each message» the reply waits until someone approves it.",
  },
  probarComentarioNoSale: { es: "En vivo no se contestaría: {motivo}.", en: "Live, it wouldn't be answered: {motivo}." },
  probarComentarioSinIntencion: {
    es: "no muestra intención de compra ni una duda concreta",
    en: "it shows no purchase intent or concrete question",
  },
  probarComentarioPidePersona: { es: "pide hablar con una persona", en: "it asks for a person" },
  probarComentarioTope: {
    es: "ya se contestó {n} veces bajo esta publicación",
    en: "it was already answered {n} times under this post",
  },
  probarComentarioPrecio: {
    es: "la respuesta citaba un precio que no está verificado ({detalle})",
    en: "the reply quoted an unverified price ({detalle})",
  },
  probarComentarioAfirma: {
    es: "la respuesta afirmaba algo que la marca no puede sostener en público",
    en: "the reply claimed something the brand can't back up in public",
  },
  probarComentarioAveriguar: {
    es: "la respuesta prometía averiguar y volver, y eso no se publica",
    en: "the reply promised to check back, which is never published",
  },
  documentsTitle: { es: 'Fuentes documentales', en: 'Document sources' },
  documentsFormats: { es: 'PDF, Word (.docx) y Excel (.xlsx). Hasta 5 MB por archivo; requiere revisión antes de usarlo.', en: 'PDF, Word (.docx) and Excel (.xlsx). Up to 5 MB per file; review required before use.' },
  documentsUpload: { es: 'Importar archivo', en: 'Import file' },
  documentsRefresh: { es: 'Actualizar', en: 'Refresh' },
  documentsEmpty: { es: 'Sin archivos importados', en: 'No imported files' },
  documentsProcessing: { es: 'Procesando…', en: 'Processing…' },
  documentsSource: { es: 'Fuente', en: 'Source' },
  documentsPreview: { es: 'Texto extraído', en: 'Extracted text' },
  documentsRevision: { es: 'Versión {n}', en: 'Version {n}' },
  documentsStatus_draft: { es: 'Borrador', en: 'Draft' },
  documentsStatus_active: { es: 'En uso', en: 'In use' },
  documentsStatus_withdrawn: { es: 'Retirado', en: 'Withdrawn' },
  documentsEditEffect: { es: 'Guardar o reemplazar deja la fuente como borrador hasta confirmarla de nuevo.', en: 'Saving or replacing makes the source a draft until you confirm it again.' },
  documentsSave: { es: 'Guardar borrador', en: 'Save draft' },
  documentsReplace: { es: 'Reemplazar archivo', en: 'Replace file' },
  documentsReview: { es: 'Revisé este texto y autorizo su uso por el asistente.', en: 'I reviewed this text and authorize the assistant to use it.' },
  documentsActivate: { es: 'Usar esta versión', en: 'Use this version' },
  documentsWithdraw: { es: 'Retirar fuente', en: 'Withdraw source' },
  documentsWithdrawEffect: { es: 'Se excluye de las próximas lecturas. Los turnos ya en curso pueden conservar su contexto; el historial queda guardado.', en: 'Excluded from subsequent reads. Turns already in progress may keep their context; history is retained.' },
  documentsWithdrawConfirm: { es: 'Confirmar retirada', en: 'Confirm withdrawal' },
  documentsBack: { es: 'Volver', en: 'Back' },
  documentsVersions: { es: 'Historial de versiones', en: 'Version history' },
  documentsVersionsLimit: { es: 'Últimas 50 versiones', en: 'Latest 50 versions' },
  document_too_large: { es: 'El archivo supera los límites de tamaño, páginas o celdas.', en: 'The file exceeds the size, page or cell limits.' },
  document_no_text: { es: 'No se encontró texto legible. Exporta el archivo con texto; no se aplica OCR.', en: 'No readable text found. Export a file with text; OCR is not applied.' },
  document_text_limit: { es: 'El texto supera 32.000 caracteres. Divide el documento.', en: 'Text exceeds 32,000 characters. Split the document.' },
  document_formulas: { es: 'Exporta Excel con valores, sin fórmulas.', en: 'Export Excel with values, without formulas.' },
  document_unreadable: { es: 'No se pudo leer el archivo. Comprueba que no esté dañado o protegido.', en: 'Unable to read the file. Check that it is not damaged or protected.' },
  document_invalid: { es: 'Revisa el archivo o los datos enviados.', en: 'Check the file or submitted data.' },
  document_changed: { es: 'La fuente cambió. Actualiza y revisa la versión vigente.', en: 'The source changed. Refresh and review the current version.' },
  document_admin_required: { es: 'Solo administradores pueden modificar o activar fuentes.', en: 'Only administrators can modify or activate sources.' },
  document_limit: { es: 'Límite: 20 fuentes, 10 activas y 48 KB de texto activo por asistente. Retira o reemplaza una fuente.', en: 'Limit: 20 sources, 10 active and 48 KB of active text per assistant. Withdraw or replace a source.' },
  document_unavailable: { es: 'No se pudo consultar o guardar la fuente. Intenta de nuevo.', en: 'Unable to read or save the source. Try again.' },
  document_busy: { es: 'Hay otros archivos en procesamiento. Intenta de nuevo.', en: 'Other files are being processed. Try again.' },
  documentsRateLimit: { es: 'Límite de importaciones alcanzado. Intenta más tarde.', en: 'Import limit reached. Try again later.' },
  invalid_document_context: { es: 'Fuente o asistente no disponible.', en: 'Source or assistant unavailable.' },
  subscription_read_only: { es: 'La cuenta está en modo de solo lectura.', en: 'The account is in read-only mode.' },
} satisfies Namespace;
