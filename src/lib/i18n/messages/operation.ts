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
    es: "Pregunta, o pide un cambio.",
    en: "Ask, or request a change.",
  },
  operatorPlaceholder: { es: "¿Qué necesitas?", en: "What do you need?" },
  operatorSend: { es: "Enviar", en: "Send" },
  operatorThinking: { es: "Pensando…", en: "Thinking…" },
  operatorError: {
    es: "No se pudo responder. Prueba de nuevo.",
    en: "Couldn't reply. Try again.",
  },
  operatorSinSaldo: {
    es: "El asistente se quedó sin crédito. Es de Riverz, no de tu cuenta: escríbenos y lo reactivamos.",
    en: "The assistant ran out of credit. That's on Riverz, not your account: write to us and we'll turn it back on.",
  },
  operatorRateLimited: {
    es: "Demasiadas consultas seguidas. Espera un minuto.",
    en: "Too many requests in a row. Wait a minute.",
  },
  // Los dos modos. El texto dice qué VA A PASAR, no cómo se llama el modo:
  // "automático" no le explica a nadie qué cambia.
  operatorNoKey: {
    es: "El Operador todavía no está habilitado en esta cuenta. Escríbele a Riverz para activarlo.",
    en: "The Operator isn't enabled on this account yet. Contact Riverz to turn it on.",
  },
  // El reparto que se aprueba de una vez.
  planTitulo: { es: "Plan de trabajo", en: "Work plan" },
  planAprobar: { es: "Aprobar", en: "Approve" },
  planCorriendo: { es: "Trabajando…", en: "Working…" },
  planAviso: {
    es: "Lo que le llegue a un cliente te lo pregunta aparte.",
    en: "Anything that reaches a customer is asked separately.",
  },

  // El banco: la pieza que se está armando, a tamaño real.
  bancoVacio: {
    es: "Acá aparece lo que el equipo va armando, a tamaño real.",
    en: "Whatever the team is building shows up here, at full size.",
  },
  bancoVer: { es: "Ver la pieza", en: "See the piece" },
  bancoTodo: { es: "Así queda", en: "How it looks" },
  bancoVacioTitulo: { es: "La pieza", en: "The piece" },
  lienzoNadaAqui: { es: "Acá no hace nada", en: "Nothing happens here" },
  mesaAbrirEnPantalla: { es: "Abrir para editar", en: "Open to edit" },
  mesaCerrar: { es: "Cerrar el panel", en: "Close the panel" },
  mesaEspera: { es: "espera al {n}", en: "waits for {n}" },
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
  chatHistorial: { es: "Conversaciones", en: "Conversations" },
  chatSinHistorial: {
    es: "Todavía no hay conversaciones anteriores.",
    en: "No previous conversations yet.",
  },
  chatEsperando: { es: "algo espera tu decisión", en: "something needs your call" },

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
  next: { es: "Continuar", en: "Continue" },
  back: { es: "Volver", en: "Back" },

  connectStore: { es: "Tienda", en: "Store" },
  connectChannels: { es: "Canales", en: "Channels" },
  connected: { es: "Conectado", en: "Connected" },
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

  // La pizarra: qué hace el agente y cuándo entra una persona
  toolsTitle: { es: "Herramientas", en: "Tools" },
  toolsHint: {
    es: "Elige qué hace solo y qué te consulta antes. Lo que apagues, lo deriva a tu equipo.",
    en: "Choose what it does on its own and what it checks with you first. Whatever you turn off, it hands to your team.",
  },
  toolModeOff: { es: "No lo hace", en: "Doesn't" },
  toolModeAprobacion: { es: "Me pregunta", en: "Asks me" },
  toolModeAuto: { es: "Lo hace solo", en: "On its own" },
  toolModeAprobacionHint: {
    es: "Lo prepara, te llega por WhatsApp y se hace cuando decís que sí.",
    en: "It prepares it, you get a WhatsApp, and it happens once you say yes.",
  },
  toolGroupCatalogo: { es: "Catálogo", en: "Catalog" },
  toolGroupVenta: { es: "Vender", en: "Selling" },
  toolGroupPedidos: { es: "Pedidos", en: "Orders" },
  toolGroupPostventa: { es: "Postventa", en: "After-sale" },
  toolGroupConversacion: { es: "En la conversación", en: "In the conversation" },
  toolNeedsTienda: { es: "Necesita una tienda conectada", en: "Needs a connected store" },
  toolNeedsShopify: { es: "Necesita Shopify", en: "Needs Shopify" },
  toolNeedsCobro: { es: "Necesita Mercado Pago", en: "Needs Mercado Pago" },
  toolNeedsDescuento: {
    es: "Necesita un tope de descuento mayor que 0",
    en: "Needs a discount cap above 0",
  },
  toolNeedsVoz: { es: "Necesita llamadas activadas", en: "Needs calling enabled" },
  toolNoAutoHint: {
    es: "No se puede deshacer, así que siempre pasa por vos.",
    en: "It cannot be undone, so it always goes through you.",
  },

  toolBuscarProducto: { es: "Buscar en el catálogo", en: "Search the catalog" },
  toolBuscarProductoHint: {
    es: "Recomendar a partir de lo que la persona describe, aunque no sepa el nombre.",
    en: "Recommend from what the person describes, even without the product name.",
  },
  toolVerProducto: { es: "Ver la ficha de un producto", en: "Open a product's details" },
  toolVerProductoHint: {
    es: "Precio real, variantes y foto. Sin esto cotiza de memoria.",
    en: "Real price, variants and photo. Without it, it quotes from memory.",
  },
  toolCrearCheckout: { es: "Mandar el link de compra", en: "Send the checkout link" },
  toolCrearCheckoutHint: {
    es: "Arma el carrito de Shopify con lo que eligió y lo lleva a pagar.",
    en: "Builds the Shopify cart with what they chose and takes them to pay.",
  },
  toolCrearLinkDePago: { es: "Cobrar por link", en: "Charge with a link" },
  toolCrearLinkDePagoHint: {
    es: "Para las tiendas sin checkout propio. El dinero va a tu cuenta.",
    en: "For stores without their own checkout. The money goes to your account.",
  },
  toolOfrecerDescuento: { es: "Ofrecer un descuento", en: "Offer a discount" },
  toolOfrecerDescuentoHint: {
    es: "Un cupón de un solo uso, nunca por encima del tope que fijaste.",
    en: "A single-use coupon, never above the cap you set.",
  },
  toolCrearPedido: { es: "Crear el pedido", en: "Create the order" },
  toolCrearPedidoHint: {
    es: "Lo arma y lo crea en tu tienda. En Tiendanube y WooCommerce es además la forma de mandarla a pagar: devuelve el enlace de pago.",
    en: "Builds it and creates it in your store. On Tiendanube and WooCommerce it is also how you send them to pay: it returns the payment link.",
  },
  toolLookupOrder: { es: "Consultar un pedido", en: "Look up an order" },
  toolLookupOrderHint: {
    es: "¿Dónde está mi pedido? es la pregunta más frecuente que recibe un comercio.",
    en: "Where is my order? is the most common question any store gets.",
  },
  toolRegistrarPago: { es: "Dar por pagado", en: "Mark as paid" },
  toolRegistrarPagoHint: {
    es: "Cuando manda el comprobante de una transferencia y le cortan los recordatorios.",
    en: "When they send a transfer receipt and the reminders stop.",
  },
  toolEditarPedido: { es: "Editar un pedido", en: "Edit an order" },
  toolEditarPedidoHint: {
    es: "Sumar unidades a algo que ya compró.",
    en: "Add units to something they already bought.",
  },
  toolCancelarPedido: { es: "Cancelar un pedido", en: "Cancel an order" },
  toolCancelarPedidoHint: {
    es: "Cancela en la tienda, vuelve el stock y se devuelve lo cobrado.",
    en: "Cancels in the store, restocks, and returns what was charged.",
  },
  toolReembolsar: { es: "Devolver el dinero", en: "Refund the money" },
  toolReembolsarHint: {
    es: "Sin cancelar la compra: llegó incompleto, llegó dañado, una bonificación.",
    en: "Without cancelling the purchase: arrived incomplete, arrived damaged, a goodwill credit.",
  },
  toolAbrirDevolucion: { es: "Abrir una devolución o cambio", en: "Open a return or exchange" },
  toolAbrirDevolucionHint: {
    es: "Deja el caso anotado con el pedido, el motivo y las fotos que ya mandó.",
    en: "Files the case with the order, the reason and the photos they already sent.",
  },
  toolEscalarLlamada: { es: "Llamar por teléfono", en: "Place a phone call" },
  toolEscalarLlamadaHint: {
    es: "Cuando por escrito no alcanza y conviene hablar.",
    en: "When writing is not enough and talking is better.",
  },
  toolEnviarProactivo: { es: "Escribir primero", en: "Message first" },
  toolEnviarProactivoHint: {
    es: "Retomar una conversación que quedó a medias.",
    en: "Pick up a conversation that stalled.",
  },
  toolNoSeLaRespuesta: { es: "Admitir que no sabe", en: "Admit it doesn't know" },
  toolNoSeLaRespuestaHint: {
    es: "Antes que inventar, lo anota y te lo deja para responder.",
    en: "Rather than make something up, it files the question for you to answer.",
  },
  toolVerContacto: { es: "Ver la ficha de quien escribe", en: "See who is writing" },
  toolVerContactoHint: {
    es: "Qué compró antes y con qué etiquetas está, para no hacerle repetir todo.",
    en: "What they bought before and how they are tagged, so they don't repeat themselves.",
  },
  toolEtiquetarContacto: { es: "Etiquetar a la persona", en: "Tag the person" },
  toolEtiquetarContactoHint: {
    es: "Una nota interna para que tu equipo la encuentre después.",
    en: "An internal note so your team can find them later.",
  },
  toolCerrarConversacion: { es: "Cerrar el caso", en: "Close the case" },
  toolCerrarConversacionHint: {
    es: "Cuando la consulta quedó resuelta y no hay nada pendiente.",
    en: "When the question is resolved and nothing is left open.",
  },

  roleLabel: { es: "Rol", en: "Role" },
  roleHint: {
    es: "Decide qué conversaciones atiende cuando hay más de un agente en el mismo canal.",
    en: "Decides which conversations it takes when more than one agent shares a channel.",
  },





  /**
   * Cómo se nombra un paso en el margen: por lo que TOCÓ, sin verbo.
   *
   * Antes había 31 etiquetas escritas a mano y convivían tres personas
   * gramaticales en la misma lista —«Revisando las plantillas», «Leo la
   * plantilla», «Escribe una plantilla de WhatsApp»— porque la tercera era el
   * respaldo, y el respaldo alcanzaba a 41 de las 72 capacidades.
   *
   * Un sustantivo no tiene persona, así que no puede quedar mal. Y el estado ya
   * lo dice el icono —girando, tilde, cruz—, con lo cual el verbo era la parte
   * que sobraba. Son veinte, uno por dominio, y cubren el catálogo entero.
   */
  domAgentes: { es: "Los agentes", en: "The agents" },
  domAjustes: { es: "Los ajustes", en: "The settings" },
  domAprobaciones: { es: "Las aprobaciones", en: "The approvals" },
  domAutomatizaciones: { es: "Las automatizaciones", en: "The automations" },
  domCampanas: { es: "Las campañas", en: "The campaigns" },
  domComentarios: { es: "Los comentarios", en: "The comments" },
  domContactos: { es: "Los contactos", en: "The contacts" },
  domConversaciones: { es: "Las conversaciones", en: "The conversations" },
  domEtiquetas: { es: "Las etiquetas", en: "The tags" },
  domFlujos: { es: "Los flujos", en: "The flows" },
  domIntegraciones: { es: "Lo conectado", en: "What is connected" },
  domMensajes: { es: "Los mensajes", en: "The messages" },
  domMetricas: { es: "Las métricas", en: "The metrics" },
  domOperacion: { es: "La cuenta", en: "The account" },
  domPedidos: { es: "Los pedidos", en: "The orders" },
  domPlantillas: { es: "Las plantillas", en: "The templates" },
  domProductos: { es: "Los productos", en: "The products" },
  domProspeccion: { es: "La prospección", en: "Prospecting" },
  domSegmentos: { es: "Los segmentos", en: "The segments" },
  domVoz: { es: "Las llamadas", en: "The calls" },

  /** Un especialista le pide algo a otro. */
  pideA: { es: "Le pide a {quien}", en: "Asks {quien}" },

  // Una sola decisión por pedido, al final del turno.
  decisionTitulo: { es: "Esto dejaría hecho", en: "This is what it would leave done" },
  decisionDescartar: { es: "Descartar", en: "Discard" },
  decisionCambiar: { es: "Cambiar", en: "Change" },
  decisionPedirCambio: { es: "Cambia esto: ", en: "Change this: " },
  decisionNadaElegido: { es: "Elige al menos una", en: "Pick at least one" },
  vivoMirando: { es: "Mirando {que}", en: "Checking {que}" },
  vivoArmando: { es: "Armando {que}", en: "Working on {que}" },
  seguir: { es: "Listo, aprobado. Continúa.", en: "Done, approved. Carry on." },
  crearPlantillas: { es: "Crear los mensajes", en: "Create the messages" },
  crearAutomatizacion: { es: "Crear la automatización", en: "Create the automation" },
  cambiarAutomatizacion: { es: "Cambiar la automatización", en: "Change the automation" },
  crearCampana: { es: "Crear la campaña", en: "Create the campaign" },
  crearSegmento: { es: "Crear el segmento", en: "Create the segment" },
  crearAgente: { es: "Crear el agente", en: "Create the agent" },
  crearRegla: { es: "Crear la regla", en: "Create the rule" },
  mandarAMeta: { es: "Mandar a aprobación de Meta", en: "Submit to Meta" },
  mandarMensaje: { es: "Mandar el mensaje", en: "Send the message" },
  detener: { es: "Detener", en: "Stop" },
  prenderPregunta: { es: "¿La prendo?", en: "Turn it on?" },
  prenderSi: { es: "Sí, prender", en: "Yes, turn it on" },
  prenderNo: { es: "Dejarla pausada", en: "Leave it paused" },

  // Lo que hizo el Operador, y lo que costó
  actividadTitulo: { es: "Lo que hice", en: "What I did" },
  actividadBajada: {
    es: "Todo lo que se aprobó en el chat, y lo que costó.",
    en: "Everything approved in the chat, and what it cost.",
  },
  actividadDias: { es: "{n} días", en: "{n} days" },
  actividadHechas: { es: "Hechas", en: "Done" },
  actividadEsperando: { es: "Esperan tu sí", en: "Awaiting you" },
  actividadDescartadas: { es: "Descartadas", en: "Discarded" },
  actividadCosto: { es: "Costo estimado", en: "Estimated cost" },
  actividadPorEspecialista: { es: "En qué se fue", en: "Where it went" },
  actividadOrquestador: { es: "Reparto", en: "Dispatch" },
  actividadCache: {
    es: "{n}% de la lectura salió del caché.",
    en: "{n}% of the input came from cache.",
  },
  actividadVacio: {
    es: "Todavía no aprobaste nada en este período.",
    en: "Nothing approved in this period yet.",
  },
  estado_ejecutado: { es: "hecho", en: "done" },
  estado_propuesto: { es: "espera tu decisión", en: "awaiting your call" },
  estado_rechazado: { es: "descartado", en: "discarded" },
  estado_fallido: { es: "falló", en: "failed" },
  actividadVer: { es: "Lo que hice", en: "What I did" },
  actividadDeshacer: { es: "Deshacer", en: "Undo" },
  actividadDeshecho: { es: "Listo, se volvió atrás.", en: "Done, it was rolled back." },
  estado_deshecho: { es: "deshecho", en: "undone" },

  // Acciones propuestas
  approve: { es: "Aprobar", en: "Approve" },
  reject: { es: "Rechazar", en: "Reject" },
  statusExecuted: { es: "Hecho", en: "Done" },
  statusRejected: { es: "Rechazado", en: "Rejected" },
  statusFailed: { es: "Falló", en: "Failed" },
  riskReversible: { es: "Se puede deshacer", en: "Can be undone" },
  riskIrreversible: { es: "No se puede deshacer", en: "Cannot be undone" },
} satisfies Namespace;
