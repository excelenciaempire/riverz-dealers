import type { Namespace } from "./types";

/** AI Assistant area: agents list page + the agent editor dialog. */
export const assistant = {
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
  apiKeyLabel: { es: "API key propia (opcional)", en: "Your own API key (optional)" },
  apiKeyPlaceholderSaved: {
    es: "••••••••  (ya hay una key guardada)",
    en: "••••••••  (a key is already saved)",
  },
  apiKeyHelp: {
    es: "Usa tu cuenta de Anthropic en vez de la del servidor. Se guarda cifrada.",
    en: "Use your own Anthropic account instead of the server's. Stored encrypted.",
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
    es: "La espera debe estar entre 0 y 60 segundos",
    en: "The wait must be between 0 and 60 seconds",
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
    es: "Elige una situación y conversa como el cliente. Verás los mensajes que recibiría y cómo responde el asistente.",
    en: "Pick a situation and chat as the customer. You'll see the messages they'd receive and how the assistant replies.",
  },
  probarVacio: {
    es: "Configura la situación arriba y pulsa Empezar.",
    en: "Set the situation above and press Start.",
  },
  probarHoy: { es: "Hoy", en: "Today" },
  probarEscenario: { es: "Situación", en: "Situation" },
  probarCanal: { es: "Canal", en: "Channel" },
  probarPago: { es: "Pago", en: "Payment" },
  probarPagoTarjeta: { es: "Tarjeta", en: "Card" },
  probarOmitida: {
    es: "«{nombre}» no se envía: {motivo}.",
    en: "“{nombre}” is not sent: {motivo}.",
  },
  probarOmisionPagado: { es: "el pedido ya está pagado", en: "the order is already paid" },
  probarOmisionDespachado: { es: "el pedido ya salió", en: "the order already shipped" },
  probarOmisionCancelado: { es: "el pedido está cancelado o reembolsado", en: "the order is cancelled or refunded" },
  probarOmisionSinGuia: { es: "el pedido no tiene número de guía", en: "the order has no tracking number" },
  probarOmisionSinEntrega: { es: "la entrega no está confirmada", en: "delivery is not confirmed" },
  probarOmisionSinCancelacion: { es: "la cancelación no está confirmada", en: "the cancellation is not confirmed" },
  probarEscMensaje: { es: "El cliente escribe primero", en: "The customer writes first" },
  probarEscPedido: { es: "Compra en la tienda", en: "Buys in the store" },
  probarEscCarrito: { es: "Deja el carrito", en: "Abandons the cart" },
  probarEscDespachado: { es: "Se despacha su pedido", en: "Their order ships" },
  probarEscEntregado: { es: "Le entregan el pedido", en: "Their order is delivered" },
  probarEscCancelado: { es: "Se cancela su pedido", en: "Their order is cancelled" },
  probarProducto: { es: "Producto", en: "Product" },
  probarPagoCod: { es: "Contra entrega", en: "Cash on delivery" },
  probarPagoPagado: { es: "Pagado", en: "Paid" },
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
  probarCondicion: { es: "Si {desc} → {camino}", en: "If {desc} → {camino}" },
  probarAsumido: { es: "(se asume: sin datos en vivo)", en: "(assumed: no live data)" },
  probarCaminoSi: { es: "sí", en: "yes" },
  probarCaminoNo: { es: "no", en: "no" },
  probarVariableVacia: {
    es: "Variable vacía: en vivo este mensaje no sale ({detalle}).",
    en: "Empty variable: live, this message does not go out ({detalle}).",
  },
  probarVentana: { es: "Sólo entre {ventana}", en: "Only between {ventana}" },
  probarSeDetiene: { es: "Se detiene si el cliente responde", en: "Stops if the customer replies" },
  probarQuienContesta: { es: "Contesta «{agente}»", en: "«{agente}» replies" },
  probarMotivoAutomatizacion: { es: "se lo entregó la automatización", en: "handed over by the automation" },
  probarMotivoPegado: { es: "ya venía contestando", en: "was already replying" },
  probarMotivoEnrutamiento: { es: "por canal y producto", en: "by channel and product" },
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
  probarSoloWhatsapp: {
    es: "Las plantillas de un evento de tienda salen por WhatsApp.",
    en: "Store-event templates go out via WhatsApp.",
  },
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
  probarEnLinea: { es: "en línea", en: "online" },
  probarSiNoRespondes: {
    es: "Si no respondes, en {n} {unit} sigue…",
    en: "If you don't reply, in {n} {unit} it continues…",
  },
  probarPasaron: { es: "Pasaron {n} {unit}", en: "{n} {unit} went by" },
  probarSeDetuvo: {
    es: "Respondiste: los recordatorios pendientes se detienen.",
    en: "You replied: the pending reminders stop.",
  },
  probarReiniciar: { es: "Empezar de nuevo", en: "Start over" },
  probarFallo: { es: "No se pudo simular", en: "Couldn't simulate" },
} satisfies Namespace;
