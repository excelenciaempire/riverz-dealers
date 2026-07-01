import type { Namespace } from "./types";

/** AI Assistant area: agents list page + the agent editor dialog. */
export const assistant = {
  // ── List page ──────────────────────────────────────────────
  pageTitle: { es: "Asistentes con IA", en: "AI assistants" },
  newAgent: { es: "Nuevo asistente", en: "New assistant" },
  createAgent: { es: "Crear asistente", en: "Create assistant" },
  emptyTitle: { es: "Tu asistente 24/7", en: "Your 24/7 assistant" },
  emptyDescription: {
    es: "Configura un agente que responde en WhatsApp, Instagram, Messenger, Gmail u Outlook con el contexto completo de cada conversación.",
    en: "Set up an agent that replies on WhatsApp, Instagram, Messenger, Gmail, or Outlook with the full context of every conversation.",
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
  wholeCatalogHint: {
    es: "Todos los productos sincronizados de Shopify.",
    en: "All products synced from Shopify.",
  },
  someProducts: { es: "Solo algunos", en: "Only some" },
  someProductsHint: { es: "Elige los productos abajo.", en: "Choose the products below." },
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

  // Editor: business tab — identity
  identityTitle: { es: "Identidad del asistente", en: "Assistant identity" },
  identityHint: {
    es: "Cómo se llama y qué tono usa. Edítalo si quieres.",
    en: "Its name and tone. Edit it if you like.",
  },
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
    es: "System prompt del asistente. Edítalo solo para afinar reglas o tono.",
    en: "The assistant's system prompt. Edit it only to fine-tune rules or tone.",
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
  allChannelsHint: {
    es: "Vale para todos los canales conectados.",
    en: "Applies to every connected channel.",
  },
  someChannels: { es: "Solo algunos", en: "Only some" },
  someChannelsHint: { es: "Elige los canales abajo.", en: "Choose the channels below." },
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
  responseBehaviorHint: {
    es: "Cómo entrega la respuesta el asistente y cuánto espera antes de hablar.",
    en: "How the assistant delivers its reply and how long it waits before speaking.",
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
    es: "Silencio del cliente antes del seguimiento. Máx. 23 h: Meta solo permite escribir dentro de las 24 h posteriores al último mensaje del cliente.",
    en: "Customer silence before the follow-up. Max 23h: Meta only allows free messages within 24h of the customer's last message.",
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

  // Proactive Instagram DM automation level (Instagram 1:1)
  proactiveModeTitle: {
    es: "DMs proactivos de Instagram",
    en: "Proactive Instagram DMs",
  },
  proactiveModeHint: {
    es: "Cuánto se automatiza el alcance 1:1 por Instagram (comentario→DM y campañas). Siempre dentro de las políticas de Meta.",
    en: "How much of the 1:1 Instagram outreach (comment→DM and campaigns) runs automatically. Always within Meta policy.",
  },
  proactiveModeAuto: {
    es: "Automático — envía solo (con opt-out y ventana de 24 h)",
    en: "Automatic — send on its own (with opt-out and 24h window)",
  },
  proactiveModeHybrid: {
    es: "Híbrido — auto para alta intención, el resto a revisión",
    en: "Hybrid — auto for high intent, the rest to review",
  },
  proactiveModeApproval: {
    es: "Aprobación — cada DM espera tu visto bueno",
    en: "Approval — every DM waits for your go-ahead",
  },
  proactiveModeFootnote: {
    es: "Los DMs en revisión aparecen en Instagram 1:1 para aprobarlos o editarlos antes de enviar.",
    en: "DMs awaiting review appear in Instagram 1:1 to approve or edit before sending.",
  },

  // Advanced: sales close
  salesCloseTitle: { es: "Cierre de ventas", en: "Sales closing" },
  salesCloseHint: {
    es: "Si está activo, el asistente arma el pedido con el cliente, confirma los datos y lo crea en Shopify. Si no, deja el cierre a una persona del equipo.",
    en: "When on, the assistant builds the order with the customer, confirms the details, and creates it in Shopify. Otherwise, it leaves the close to a team member.",
  },
  connectShopifyFirst: {
    es: "Primero conecta Shopify para activar el cierre de ventas.",
    en: "Connect Shopify first to enable sales closing.",
  },
  salesCloseConnectPrompt: {
    es: "Para que el asistente cree pedidos necesitas conectar Shopify. Hazlo aquí mismo sin salir de esta pantalla.",
    en: "To let the assistant create orders, you need to connect Shopify. Do it right here without leaving this screen.",
  },
  connect: { es: "Conectar", en: "Connect" },
  cancel: { es: "Cancelar", en: "Cancel" },
  linkShopify: { es: "Vincular Shopify", en: "Link Shopify" },
  linkingHint: {
    es: "Completa la conexión en la ventana emergente… se activa solo al terminar.",
    en: "Finish the connection in the pop-up… it turns on automatically when done.",
  },
  salesCloseActiveHint: {
    es: "El asistente pregunta lo que falte (datos de envío, método de pago) y solo crea el pedido cuando el cliente confirma.",
    en: "The assistant asks for whatever's missing (shipping details, payment method) and only creates the order once the customer confirms.",
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
  hoursStartBeforeEnd: {
    es: "La hora de inicio debe ser menor que la de fin",
    en: "The start time must be earlier than the end time",
  },
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
} satisfies Namespace;
