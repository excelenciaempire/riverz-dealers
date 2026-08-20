import type { Namespace } from "./types";

/**
 * El Operador y su asistente de activación.
 *
 * Acá vivía además el Centro de Operación IA, que era una segunda pantalla de
 * cifras al lado de Inicio. Se juntaron, y en la mudanza se cayeron las que
 * medían configuración en vez de resultado —agentes activos, automatizaciones
 * activas, canales conectados, corridas—: suben igual cuando la cuenta anda
 * mal. Inicio quedó con plata y atención, en el namespace `dashboard`.
 */
export const operation = {
  // Operator
  operatorTitle: { es: "Operator", en: "Operator" },
  operatorHint: {
    es: "Pregúntale por tu operación o pídele un cambio. Antes de tocar nada, te muestra qué haría.",
    en: "Ask about your operation or request a change. Before touching anything, it shows you what it would do.",
  },
  operatorPlaceholder: { es: "¿Qué necesitas?", en: "What do you need?" },
  operatorSend: { es: "Enviar", en: "Send" },
  operatorThinking: { es: "Pensando…", en: "Thinking…" },
  operatorError: {
    es: "No se pudo responder. Prueba de nuevo.",
    en: "Couldn't reply. Try again.",
  },
  operatorRateLimited: {
    es: "Demasiadas consultas seguidas. Espera un minuto.",
    en: "Too many requests in a row. Wait a minute.",
  },
  // Los dos modos. El texto dice qué VA A PASAR, no cómo se llama el modo:
  // "automático" no le explica a nadie qué cambia.
  modeAuto: {
    es: "Construye solo · pide permiso para publicar",
    en: "Builds on its own · asks before publishing",
  },
  modeAsk: {
    es: "Pide permiso antes de construir",
    en: "Asks before building",
  },
  operatorNoKey: {
    es: "El Operador todavía no está habilitado en esta cuenta. Escríbele a Riverz para activarlo.",
    en: "The Operator isn't enabled on this account yet. Contact Riverz to turn it on.",
  },
  operatorOverBudget: {
    es: "Llegaste al límite de uso del Operador por hoy. Vuelve a intentar mañana.",
    en: "You've hit today's Operator usage limit. Try again tomorrow.",
  },
  // El reparto que se aprueba de una vez.
  planTitulo: { es: "Así lo repartiría", en: "Here is how I would split it" },
  planAprobar: { es: "Aprobar y que trabajen", en: "Approve and let them work" },
  planCorriendo: { es: "Trabajando…", en: "Working…" },
  planAviso: {
    es: "Aprobar esto deja que el equipo construya. Lo que le llegue a un cliente, salga a Meta o mueva dinero te lo va a preguntar aparte.",
    en: "Approving this lets the team build. Anything that reaches a customer, goes out to Meta or moves money will still be asked separately.",
  },

  // La mesa de trabajo: qué está armando el equipo, ahora.
  mesaTitulo: { es: "El equipo", en: "The team" },
  mesaCerrar: { es: "Cerrar el panel", en: "Close the panel" },
  mesaVer: { es: "Ver el equipo", en: "See the team" },
  mesaPlan: { es: "El reparto", en: "The plan" },
  mesaEspera: { es: "espera al {n}", en: "waits for {n}" },
  mesaGasto: { es: "{n} tokens en este turno", en: "{n} tokens this turn" },
  // Los catorce del equipo, como se ven en la mesa.
  subAutomatizaciones: { es: "Automatizaciones", en: "Automations" },
  subFlujos: { es: "Flujos", en: "Flows" },
  subPlantillas: { es: "Plantillas", en: "Templates" },
  subCampanas: { es: "Campañas", en: "Campaigns" },
  subBandeja: { es: "Bandeja", en: "Inbox" },
  subContactos: { es: "Contactos", en: "Contacts" },
  subProductos: { es: "Productos", en: "Products" },
  subComentarios: { es: "Comentarios", en: "Comments" },
  subVoz: { es: "Llamadas", en: "Calls" },
  subAgentes: { es: "Agentes", en: "Agents" },
  subProspeccion: { es: "Prospección", en: "Prospecting" },
  subPedidos: { es: "Pedidos", en: "Orders" },
  subIntegraciones: { es: "Integraciones", en: "Integrations" },
  subAjustes: { es: "Ajustes", en: "Settings" },

  // Historial: cada conversación es su propio contexto.
  chatNuevo: { es: "Chat nuevo", en: "New chat" },
  chatBorrar: { es: "Borrar esta conversación", en: "Delete this conversation" },

  operatorTry1: { es: "¿Cómo viene la semana?", en: "How is the week going?" },
  operatorTry2: { es: "¿Qué está frenando las ventas?", en: "What is holding sales back?" },
  operatorTry3: {
    es: "Activa la recuperación de carritos",
    en: "Turn on cart recovery",
  },

  // Activación guiada
  activateTitle: { es: "Activa tu Operación IA", en: "Activate your AI Operation" },
  activateSubtitle: {
    es: "Conecta tu tienda y tus canales. Riverz arma el equipo y tú apruebas antes de que atienda a nadie.",
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
    es: "No se pudo leer ese sitio. Puedes seguir sin esto.",
    en: "Couldn't read that site. You can continue without it.",
  },

  goalTitle: { es: "¿Qué quieres resolver primero?", en: "What do you want to solve first?" },
  goalHint: { es: "Puedes elegir más de uno.", en: "You can pick more than one." },
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
    es: "Revisa cada pieza y enciende lo que quieras que empiece a trabajar.",
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

  // Métricas que suma la operación al panel
  mResolved: { es: "Resueltas", en: "Resolved" },
  mAiAnswered: { es: "Respondió la IA", en: "AI answered" },
  mAiBreakdown: {
    es: "{skipped} se abstuvo · {failed} falló",
    en: "{skipped} skipped · {failed} failed",
  },
  mOrders: { es: "Pedidos", en: "Orders" },
  mRevenue: { es: "Facturado", en: "Revenue" },

  templatesTitle: { es: "Plantillas de WhatsApp", en: "WhatsApp templates" },
  templatesTotal: { es: "Total", en: "Total" },
  templatesRejected: { es: "Rechazadas", en: "Rejected" },
  templatesPending: { es: "En revisión", en: "In review" },

  campaignsTitle: { es: "Campañas del período", en: "Campaigns in the period" },
  cSent: { es: "Enviados", en: "Sent" },
  cDelivered: { es: "Entregados", en: "Delivered" },
  cRead: { es: "Leídos", en: "Read" },
  cReplied: { es: "Respondieron", en: "Replied" },
  cFailed: { es: "Fallaron", en: "Failed" },
  cStalled: { es: "Trabadas", en: "Stalled" },

  // Lo que se ve mientras trabaja
  operatorReasoning: { es: "Pensando", en: "Thinking" },
  stepEstado: { es: "Mirando el estado de la cuenta", en: "Checking the account status" },
  stepMetricas: { es: "Mirando las métricas", en: "Checking the metrics" },
  stepPendientes: { es: "Mirando las conversaciones sin responder", en: "Checking unanswered conversations" },
  stepContacto: { es: "Buscando el contacto", en: "Looking up the contact" },
  stepDiagnostico: { es: "Revisando por qué no salió", en: "Checking why it didn't go out" },
  stepPedidos: { es: "Mirando los pedidos", en: "Checking the orders" },
  stepPlantillas: { es: "Revisando las plantillas", en: "Checking the templates" },
  stepCampanas: { es: "Revisando las campañas", en: "Checking the campaigns" },
  stepAgentes: { es: "Mirando los agentes", en: "Checking the agents" },
  stepAgenteCrear: { es: "Preparando un agente", en: "Preparing an agent" },
  stepAgenteActivar: { es: "Prendiendo un agente", en: "Turning on an agent" },
  stepAutosListar: { es: "Mirando las automatizaciones", en: "Checking the automations" },
  stepRecetas: { es: "Viendo qué recetas hay", en: "Checking available recipes" },
  stepAutoActivar: { es: "Prendiendo una automatización", en: "Turning on an automation" },
  stepAutoEspera: { es: "Ajustando una espera", en: "Adjusting a wait" },
  stepAutoCrear: { es: "Armando la automatización", en: "Building the automation" },
  stepAutoCrearCero: { es: "Armando una automatización", en: "Building an automation" },
  stepAprobPend: { es: "Mirando qué espera aprobación", en: "Checking what awaits approval" },
  stepAprobDecidir: { es: "Resolviendo una aprobación", en: "Resolving an approval" },
  // A quién le hablamos
  stepContactosListar: { es: "Mirando los contactos", en: "Checking the contacts" },
  stepEtiquetas: { es: "Viendo qué etiquetas hay", en: "Checking available tags" },
  stepSegmentosListar: { es: "Mirando los segmentos", en: "Checking the segments" },
  stepSegmentoCalcular: { es: "Contando a cuánta gente alcanza", en: "Counting how many it reaches" },
  stepSegmentoCrear: { es: "Guardando el segmento", en: "Saving the segment" },
  stepEtiquetar: { es: "Etiquetando contactos", en: "Tagging contacts" },

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
