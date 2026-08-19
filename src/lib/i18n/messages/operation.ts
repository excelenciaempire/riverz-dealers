import type { Namespace } from "./types";

/**
 * Centro de Operación IA — la pantalla de Riverz 2.0.
 *
 * El orden de lectura manda sobre el texto: primero lo que necesita atención,
 * después lo que la operación hizo sola, y al final los números. Un panel que
 * arranca con gráficos obliga a buscar el problema.
 */
export const operation = {
  title: { es: "Operación IA", en: "AI Operation" },
  subtitle: {
    es: "Lo que tu operación resolvió sola y lo que necesita a alguien.",
    en: "What your operation handled on its own and what needs someone.",
  },

  // Lo que necesita atención
  needsYou: { es: "Necesita tu atención", en: "Needs your attention" },
  allClear: { es: "Nada pendiente", en: "Nothing pending" },
  allClearHint: {
    es: "No hay envíos fallando, plantillas rechazadas ni automatizaciones trabadas.",
    en: "No failing sends, rejected templates or stuck automations.",
  },
  waitingApproval: { es: "Esperando tu decisión", en: "Waiting on your decision" },
  pendingReplies: { es: "Conversaciones sin responder", en: "Unanswered conversations" },
  hoursWaiting: { es: "{n} h esperando", en: "{n} h waiting" },
  askedForHuman: { es: "Pidió una persona", en: "Asked for a person" },

  // Qué está corriendo
  running: { es: "Qué está corriendo", en: "What is running" },
  agentsActive: { es: "Agentes activos", en: "Active agents" },
  automationsActive: { es: "Automatizaciones activas", en: "Active automations" },
  channelsConnected: { es: "Canales conectados", en: "Connected channels" },
  runs24h: { es: "Corridas (24 h)", en: "Runs (24h)" },
  runsBreakdown: {
    es: "{ok} bien · {partial} a medias · {failed} fallidas",
    en: "{ok} fine · {partial} partial · {failed} failed",
  },
  nothingRunning: { es: "Todavía no hay nada activo", en: "Nothing active yet" },
  nothingRunningHint: {
    es: "Conectá tu tienda y tus canales para que Riverz empiece a operar.",
    en: "Connect your store and channels so Riverz can start operating.",
  },

  // Resultados
  results: { es: "Resultados", en: "Results" },
  conversations: { es: "Conversaciones", en: "Conversations" },
  aiAnswered: { es: "Respondió la IA", en: "AI answered" },
  newContacts: { es: "Contactos nuevos", en: "New contacts" },
  orders: { es: "Pedidos", en: "Orders" },
  vsPrevious: { es: "vs. período anterior", en: "vs. previous period" },

  // Estados
  loadError: { es: "No se pudo cargar la operación", en: "Couldn't load the operation" },
  retry: { es: "Reintentar", en: "Retry" },
  seeAll: { es: "Ver todo", en: "See all" },
  resolve: { es: "Resolver", en: "Resolve" },

  // Operator
  operatorTitle: { es: "Operator", en: "Operator" },
  operatorHint: {
    es: "Preguntale por tu operación o pedile un cambio. Antes de tocar nada, te muestra qué haría.",
    en: "Ask about your operation or request a change. Before touching anything, it shows you what it would do.",
  },
  operatorPlaceholder: { es: "¿Qué necesitás?", en: "What do you need?" },
  operatorSend: { es: "Enviar", en: "Send" },
  operatorThinking: { es: "Pensando…", en: "Thinking…" },
  operatorError: {
    es: "No se pudo responder. Probá de nuevo.",
    en: "Couldn't reply. Try again.",
  },
  operatorRateLimited: {
    es: "Demasiadas consultas seguidas. Esperá un minuto.",
    en: "Too many requests in a row. Wait a minute.",
  },
  operatorTry1: { es: "¿Cómo viene la semana?", en: "How is the week going?" },
  operatorTry2: { es: "¿Qué está frenando las ventas?", en: "What is holding sales back?" },
  operatorTry3: {
    es: "Activá recuperación de carritos",
    en: "Turn on cart recovery",
  },

  // Activación guiada
  activateTitle: { es: "Activá tu Operación IA", en: "Activate your AI Operation" },
  activateSubtitle: {
    es: "Conectá tu tienda y tus canales. Riverz arma el equipo y vos aprobás antes de que atienda a nadie.",
    en: "Connect your store and channels. Riverz builds the team and you approve before it talks to anyone.",
  },
  activateCta: { es: "Activar mi operación", en: "Activate my operation" },
  stepConnect: { es: "Conectar", en: "Connect" },
  stepBrand: { es: "Tu marca", en: "Your brand" },
  stepGoal: { es: "Objetivo", en: "Goal" },
  stepPlan: { es: "Plan", en: "Plan" },
  next: { es: "Continuar", en: "Continue" },
  back: { es: "Volver", en: "Back" },

  connectStore: { es: "Tienda", en: "Store" },
  connectChannels: { es: "Canales", en: "Channels" },
  connected: { es: "Conectado", en: "Connected" },
  notConnected: { es: "Sin conectar", en: "Not connected" },
  goConnect: { es: "Conectar", en: "Connect" },
  connectHint: {
    es: "Con la tienda conectada, la IA puede consultar pedidos y armar links de pago.",
    en: "With the store connected, the AI can look up orders and build payment links.",
  },

  brandUrlLabel: { es: "Sitio de tu marca", en: "Your brand's website" },
  brandUrlHint: {
    es: "Riverz lo lee y prepara un agente con tu tono y tus preguntas frecuentes. Queda en borrador.",
    en: "Riverz reads it and prepares an agent with your tone and FAQs. It stays as a draft.",
  },
  brandRead: { es: "Leer mi sitio", en: "Read my site" },
  brandReading: { es: "Leyendo tu sitio…", en: "Reading your site…" },
  brandDone: { es: "Listo: preparé este agente", en: "Done: here's the agent I prepared" },
  brandSkip: { es: "Saltar este paso", en: "Skip this step" },
  brandError: {
    es: "No se pudo leer ese sitio. Podés seguir sin esto.",
    en: "Couldn't read that site. You can continue without it.",
  },

  goalTitle: { es: "¿Qué querés resolver primero?", en: "What do you want to solve first?" },
  goalHint: { es: "Podés elegir más de uno.", en: "You can pick more than one." },
  pbAftersaleTitle: { es: "Bajar la carga de postventa", en: "Reduce after-sales load" },
  pbAftersaleWhat: {
    es: "Estado del pedido, guías, cambios y preguntas frecuentes, sin que nadie las conteste a mano.",
    en: "Order status, tracking, changes and FAQs, without anyone answering by hand.",
  },
  pbRecoveryTitle: { es: "Recuperar ventas perdidas", en: "Recover lost sales" },
  pbRecoveryWhat: {
    es: "Carritos abandonados, pagos pendientes y pagos rechazados.",
    en: "Abandoned carts, pending payments and rejected payments.",
  },
  pbSalesTitle: { es: "Vender y que vuelvan", en: "Sell and bring them back" },
  pbSalesWhat: {
    es: "Atiende consultas, cierra la venta y le vuelve a escribir a quien ya compró.",
    en: "Answers questions, closes the sale and writes back to those who already bought.",
  },

  planTitle: { es: "Esto es lo que voy a crear", en: "This is what I'll create" },
  planAgents: { es: "Agentes", en: "Agents" },
  planAutomations: { es: "Automatizaciones", en: "Automations" },
  planPaused: {
    es: "Todo nace en pausa. Nada le escribe a un cliente hasta que lo prendas.",
    en: "Everything starts paused. Nothing writes to a customer until you turn it on.",
  },
  planApply: { es: "Crear todo esto", en: "Create all of this" },
  planApplying: { es: "Creando…", en: "Creating…" },
  planDone: { es: "Listo. Tu operación está armada.", en: "Done. Your operation is set up." },
  planDoneHint: {
    es: "Revisá cada pieza y prendé lo que quieras que empiece a trabajar.",
    en: "Review each piece and turn on whatever you want working.",
  },
  goToCenter: { es: "Ir al centro de operación", en: "Go to the operation center" },
  planFailed: { es: "No se pudo crear", en: "Couldn't create" },

  // Roles de la flota
  roleSalesName: { es: "Ventas", en: "Sales" },
  roleAftersaleName: { es: "Postventa", en: "After-sales" },
  roleRecoveryName: { es: "Recuperación", en: "Recovery" },
  roleRetentionName: { es: "Recompra", en: "Repurchase" },
  roleGeneralName: { es: "General", en: "General" },
  roleSalesWhat: {
    es: "Responde consultas, recomienda y cierra la venta.",
    en: "Answers questions, recommends and closes the sale.",
  },
  roleAftersaleWhat: {
    es: "Estado del pedido, guías, cambios y preguntas frecuentes.",
    en: "Order status, tracking, changes and FAQs.",
  },
  roleRecoveryWhat: {
    es: "Carritos abandonados, pagos pendientes y rechazados.",
    en: "Abandoned carts, pending and rejected payments.",
  },
  roleRetentionWhat: {
    es: "Vuelve a escribirle a quien ya compró.",
    en: "Writes back to those who already bought.",
  },
  roleGeneralWhat: {
    es: "Atiende todo sin reparto de trabajo.",
    en: "Handles everything without splitting work.",
  },

  // Permisos por acción
  permissionsTitle: { es: "Qué puede hacer", en: "What it can do" },
  permissionsHint: {
    es: "Lo que quede apagado, el agente lo deriva a tu equipo.",
    en: "Whatever stays off, the agent hands to your team.",
  },
  permCrearPedidos: { es: "Crear pedidos", en: "Create orders" },
  permCrearCheckout: { es: "Enviar link de pago", en: "Send payment link" },
  permRegistrarPago: { es: "Registrar un pago informado", en: "Record a reported payment" },
  permEditarPedido: { es: "Editar un pedido", en: "Edit an order" },
  permEscalarLlamada: { es: "Llamar por teléfono", en: "Place a phone call" },
  permEnviarProactivo: { es: "Escribir primero", en: "Message first" },
  roleLabel: { es: "Rol", en: "Role" },
  roleHint: {
    es: "Decide qué conversaciones atiende cuando hay más de un agente en el mismo canal.",
    en: "Decides which conversations it takes when more than one agent shares a channel.",
  },

  // Acciones propuestas
  proposedTitle: { es: "Esperando tu aprobación", en: "Waiting for your approval" },
  approve: { es: "Aprobar", en: "Approve" },
  reject: { es: "Rechazar", en: "Reject" },
  statusExecuted: { es: "Hecho", en: "Done" },
  statusRejected: { es: "Rechazado", en: "Rejected" },
  statusFailed: { es: "Falló", en: "Failed" },
  riskReversible: { es: "Se puede deshacer", en: "Can be undone" },
  riskIrreversible: { es: "No se puede deshacer", en: "Cannot be undone" },
} satisfies Namespace;
