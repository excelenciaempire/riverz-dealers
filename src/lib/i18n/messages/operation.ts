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
