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
  contextTitle: { es:'Condiciones por canal',en:'Conditions by channel' },
  contextHint: { es:'Puedes limitar una acción o pedir aprobación en un canal. Nunca habilita algo apagado en los permisos generales ni elimina una aprobación financiera.',en:'Restrict an action or require approval on a channel. Never enables something disabled globally or removes a financial approval.' },
  contextChannel: { es:'Canal de origen',en:'Source channel' },
  contextInherit: { es:'Usar permisos generales',en:'Use global permissions' },
  contextApply: { es:'Se guardan por separado de los cambios generales del editor. Aplican a los próximos turnos; no cancelan acciones ya iniciadas. En comentarios se usa el canal donde empezó la consulta.',en:'Saved separately from the editor’s general changes. Apply to future turns; do not cancel actions already started. Comments use the channel where the inquiry began.' },
  contextSave: { es:'Guardar condiciones',en:'Save conditions' },
  contextReload: { es:'Recargar condiciones',en:'Reload conditions' },
  contextSaved: { es:'Condiciones guardadas.',en:'Conditions saved.' },
  contextHistory: { es:'Historial de condiciones',en:'Condition history' },
  contextHistoryPartial: { es:'Se muestran las veinte versiones más recientes.',en:'Showing the twenty most recent versions.' },
  contextWorking: { es:'Consultando condiciones…',en:'Loading conditions…' },
  contextFailed: { es:'No se pudo comprobar el resultado. Recarga las condiciones antes de editar nuevamente.',en:'Could not verify the result. Reload conditions before editing again.' },
  contextInvalid: { es:'Revisa el canal, la acción y la versión de las condiciones.',en:'Check the channel, action and condition version.' },
  contextNotFound: { es:'El asistente o sus condiciones no están disponibles en este negocio.',en:'The assistant or its conditions are unavailable in this business.' },
  contextAdminRequired: { es:'Solo un administrador puede guardar condiciones de acciones.',en:'Only an administrator can save action conditions.' },
  contextChanged: { es:'Las condiciones cambiaron. Recárgalas antes de guardar.',en:'Conditions changed. Reload them before saving.' },
  contextReadOnly: { es:'El negocio está en modo de lectura. No se cambiaron condiciones.',en:'The business is read-only. Conditions were not changed.' },
  imageAttach: { es: 'Adjuntar imágenes', en: 'Attach images' },
  imageRemove: { es: 'Quitar imagen', en: 'Remove image' },
  imageConversation: { es: 'Imagen adjunta', en: 'Attached image' },
  imageInvalid: { es: 'Adjunta hasta 3 imágenes JPG, PNG, WebP o GIF de máximo 5 MB cada una.', en: 'Attach up to 3 JPG, PNG, WebP or GIF images, up to 5 MB each.' },
  agentUnavailable: { es: 'El agente no está disponible en este comercio.', en: 'The agent is not available in this workspace.' },
  threadUnavailable: { es: 'La conversación no está disponible en este comercio.', en: 'The conversation is not available in this workspace.' },
  webchatUpdate: { es: "Actualizar configuración del chat web", en: "Update web chat settings" },
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
    es: "Aquí aparece lo que el equipo va armando, a tamaño real.",
    en: "Whatever the team is building shows up here, at full size.",
  },
  bancoVer: { es: "Ver la pieza", en: "See the piece" },
  bancoVacioTitulo: { es: "La pieza", en: "The piece" },
  lienzoNadaAqui: { es: "Aquí no hace nada", en: "Nothing happens here" },
  mesaAbrirEnPantalla: { es: "Abrir para editar", en: "Open to edit" },
  mesaCerrar: { es: "Cerrar el panel", en: "Close the panel" },
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

  validationTitle: { es: "Valida antes de activar", en: "Validate before activating" },
  validationHint: {
    es: "Prueba el agente con los mismos datos y herramientas de producción. No se envía ni modifica nada.",
    en: "Test the agent with the same production data and tools. Nothing is sent or changed.",
  },
  validationRun: { es: "Ejecutar pruebas", en: "Run tests" },
  validationRunning: { es: "Probando…", en: "Testing…" },
  validationPassed: { es: "Listo para activar", en: "Ready to activate" },
  validationWarning: { es: "Requiere revisión humana", en: "Needs human review" },
  validationBlocked: { es: "Falta configurar información esencial", en: "Essential information is missing" },
  validationRelease: { es: "Activar respuestas automáticas", en: "Enable automatic replies" },
  validationReleased: { es: "Respuestas automáticas activadas", en: "Automatic replies enabled" },
  validationNoAgent: { es: "Crea un agente en borrador para empezar la validación.", en: "Create a draft agent to start validation." },
  validationError: { es: "No se pudo completar la validación.", en: "Couldn't complete validation." },
  validationScenario: { es: "Prueba", en: "Test" },

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
  cobroTitle: { es: "Cómo se cobra", en: "How it charges" },
  cobroHint: {
    es: "Con qué cierra la venta cuando puede hacer las dos cosas.",
    en: "How it closes the sale when it can do both.",
  },
  cobroSegunPago: {
    es: "Contra entrega en el chat, tarjeta a la caja",
    en: "Cash on delivery in chat, card to checkout",
  },
  cobroChat: { es: "Siempre toma el pedido en el chat", en: "Always take the order in chat" },
  cobroCheckout: { es: "Siempre manda a la caja", en: "Always send to checkout" },
  mediosTitle: { es: "Con qué se puede pagar", en: "Accepted payment methods" },
  mediosHint: {
    es: "Si no marcas ninguno, el asistente no nombra medios de pago: pasa la conversación a una persona.",
    en: "If you tick none, the assistant won't name any payment method: it hands the conversation to a person.",
  },
  medioTarjeta: { es: "Tarjeta de crédito o débito", en: "Credit or debit card" },
  medioTransferencia: { es: "Transferencia bancaria", en: "Bank transfer" },
  medioMercadopago: { es: "Mercado Pago", en: "Mercado Pago" },
  medioEfectivo: { es: "Efectivo", en: "Cash" },
  medioContraentrega: { es: "Pago al recibir (contra entrega)", en: "Cash on delivery" },
  medioLink_de_pago: { es: "Link de pago", en: "Payment link" },
  toolsHint: {
    es: "Elige qué hace solo y qué te consulta antes. Lo que apagues, lo deriva a tu equipo.",
    en: "Choose what it does on its own and what it checks with you first. Whatever you turn off, it hands to your team.",
  },
  toolModeOff: { es: "No lo hace", en: "Doesn't" },
  toolModeAprobacion: { es: "Me pregunta", en: "Asks me" },
  toolModeAuto: { es: "Lo hace solo", en: "On its own" },
  toolModeAprobacionHint: {
    es: "Lo prepara, te llega por WhatsApp y se hace cuando dices que sí.",
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
    es: "No se puede deshacer, así que siempre pasa por ti.",
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
    es: "Lo arma y lo crea en tu tienda. En Tiendanube y WooCommerce devuelve además el enlace de pago.",
    en: "Builds it and creates it in your store. On Tiendanube and WooCommerce it also returns the payment link.",
  },
  toolLookupOrder: { es: "Consultar un pedido", en: "Look up an order" },
  toolLookupOrderHint: {
    es: "Responde «¿dónde está mi pedido?» con el estado y la guía.",
    en: "Answers “where is my order?” with the status and tracking.",
  },
  toolRegistrarPago: { es: "Dar por pagado", en: "Mark as paid" },
  toolRegistrarPagoHint: {
    es: "Con el comprobante de la transferencia: corta los recordatorios y marca el pedido pagado en tu tienda.",
    en: "From the transfer receipt: stops the reminders and marks the order paid in your store.",
  },
  pagoExigeComprobante: { es: "Exigir un comprobante", en: "Require a receipt" },
  pagoUnSoloPendiente: {
    es: "Un solo pedido pendiente",
    en: "Only one pending order",
  },
  pagoExigeReferencia: {
    es: "Número de operación sin repetir",
    en: "Unique transaction number",
  },
  pagoTolerancia: { es: "El monto puede diferir", en: "The amount may differ by" },
  pagoReglasFlojas: {
    es: "Con menos pruebas, acertar el total alcanza para que un pedido quede pagado.",
    en: "With fewer checks, guessing the total is enough for an order to end up paid.",
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
  toolTopeDescuento: { es: "Hasta", en: "Up to" },
  toolBuscarEnInternet: { es: "Buscar en internet", en: "Search the web" },
  toolBuscarEnInternetHint: {
    es: "Solo cuando la respuesta no está en tus productos. Lo tuyo siempre manda.",
    en: "Only when the answer isn't in your products. Yours always wins.",
  },
  toolNoSeLaRespuesta: { es: "Admitir que no sabe", en: "Admit it doesn't know" },
  toolNoSeLaRespuestaHint: {
    es: "Antes que inventar, lo anota y te lo deja para responder.",
    en: "Rather than make something up, it files the question for you to answer.",
  },
  toolVerContacto: { es: "Ver la ficha de quien escribe", en: "See who is writing" },
  toolGestionarRecompra: { es: 'Gestionar recordatorios de recompra', en: 'Manage reorder reminders' },
  toolGestionarRecompraHint: { es: 'Cancela o reprograma el seguimiento de la persona que responde, según lo acordado.', en: 'Cancel or reschedule follow-up for the person replying, as agreed.' },
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
  domBandeja: { es: "La bandeja", en: "The inbox" },
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
  decisionEditar: { es: "Editar", en: "Edit" },
  /**
   * Tocar «Editar» deja la propuesta condenada: el siguiente mensaje la
   * descarta, diga lo que diga. Sin avisarlo, quien escribía cualquier otra
   * cosa —un «excelente»— perdía el cambio y se quedaba mirando una tarjeta
   * sin botones, sin nada que explicara por qué.
   */
  decisionCambioArmado: {
    es: "Tu próximo mensaje reemplaza esta propuesta. Para aprobarla tal como está, cancela el cambio.",
    en: "Your next message replaces this proposal. To approve it as is, cancel the change.",
  },
  decisionCambioCancelar: { es: "Cancelar el cambio", en: "Cancel change" },
  decisionReemplazada: {
    es: "Reemplazada por tu pedido de cambio.",
    en: "Replaced by your change request.",
  },
  /**
   * Qué está haciendo, por dominio y en una frase.
   *
   * Antes se armaba pegándole un gerundio al nombre del dominio —«Armando las
   * automatizaciones», «Armando bandeja»— y la mitad de las combinaciones no
   * eran castellano. Escritas enteras, cada una dice lo que de verdad pasa.
   */
  haciendoAutomatizaciones: {
    es: "Armando la automatización",
    en: "Building the automation",
  },
  haciendoFlujos: { es: "Armando el menú", en: "Building the menu" },
  haciendoPlantillas: { es: "Escribiendo el mensaje", en: "Writing the message" },
  haciendoCampanas: { es: "Preparando la campaña", en: "Preparing the campaign" },
  haciendoConversaciones: { es: "Ordenando la bandeja", en: "Sorting the inbox" },
  haciendoMensajes: { es: "Preparando el mensaje", en: "Preparing the message" },
  haciendoContactos: { es: "Armando el público", en: "Building the audience" },
  haciendoEtiquetas: { es: "Poniendo las etiquetas", en: "Applying the tags" },
  haciendoSegmentos: { es: "Armando el segmento", en: "Building the segment" },
  haciendoProductos: { es: "Leyendo la ficha del producto", en: "Reading the product" },
  haciendoComentarios: { es: "Armando la regla", en: "Building the rule" },
  haciendoVoz: { es: "Preparando la llamada", en: "Preparing the call" },
  haciendoAgentes: { es: "Ajustando el agente", en: "Adjusting the agent" },
  haciendoProspeccion: { es: "Preparando la prospección", en: "Preparing outreach" },
  haciendoPedidos: { es: "Armando el pedido", en: "Building the order" },
  haciendoIntegraciones: { es: "Cambiando lo conectado", en: "Changing connections" },
  haciendoAjustes: { es: "Cambiando los ajustes", en: "Changing settings" },
  haciendoAprobaciones: { es: "Resolviendo la aprobación", en: "Resolving the approval" },
  haciendoMetricas: { es: "Sacando las cuentas", en: "Running the numbers" },
  haciendoOperacion: { es: "Mirando cómo va la cuenta", en: "Checking the account" },
  /** Un especialista le pide algo a otro. */
  consultando: { es: "Consultando {que}", en: "Checking {que}" },
  vivoMirando: { es: "Revisando {que}", en: "Going through {que}" },
  vivoArmando: { es: "Armando {que}", en: "Working on {que}" },
  vivoEmpezando: { es: "Leyendo tu cuenta", en: "Reading your account" },
  /** Mientras razona y todavía no llamó a nadie. Es lo que de verdad pasa. */
  vivoPensando: { es: "Pensando", en: "Thinking" },
  /** Al aprobar el plan: por dónde se empieza, para no dejar la pantalla muda. */
  planArranco: {
    es: "Listo. Empiezo por el paso 1: {que}.",
    en: "Done. Starting with step 1: {que}.",
  },
  planArrancoUno: { es: "Listo, arranco: {que}.", en: "Done, starting: {que}." },
  /**
   * Lo que el click de «Aprobar» dice en la conversación.
   *
   * Aparece como un mensaje de la persona —porque es su decisión— así que
   * tiene que leerse como algo que alguien escribiría. «Continúa con lo que
   * falta, sin volver a proponer eso» es una instrucción para el modelo puesta
   * en boca del comercio; «eso ya está hecho» dice lo mismo y es una frase.
   */
  seguir: { es: "Aprobado. Sigue con lo que falta.", en: "Approved. Carry on with what is left." },
  /**
   * El título de la decisión: que la cosa YA está, y qué se puede hacer.
   *
   * Sin «lo/la»: el género cambia con cada cosa, y la frase se puede escribir
   * sin el pronombre.
   */
  decisionAsi: {
    es: "Así queda {que}. ¿Apruebas o cambiamos algo?",
    en: "This is how {que} looks. Approve, or change something?",
  },
  decisionAsiVarias: {
    es: "Así quedan {que}. ¿Apruebas o cambiamos algo?",
    en: "This is how {que} look. Approve, or change something?",
  },
  nomPlantilla: { es: "el mensaje", en: "the message" },
  nomPlantillas: { es: "los {n} mensajes", en: "the {n} messages" },
  nomAuto: { es: "la automatización", en: "the automation" },
  nomAutos: { es: "las {n} automatizaciones", en: "the {n} automations" },
  nomCampana: { es: "la campaña", en: "the campaign" },
  nomCampanas: { es: "las {n} campañas", en: "the {n} campaigns" },
  nomSegmento: { es: "el segmento", en: "the segment" },
  nomSegmentos: { es: "los {n} segmentos", en: "the {n} segments" },
  nomAgente: { es: "el agente", en: "the agent" },
  nomAgentes: { es: "los {n} agentes", en: "the {n} agents" },
  nomRegla: { es: "la regla", en: "the rule" },
  nomReglas: { es: "las {n} reglas", en: "the {n} rules" },
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

  // El paso 4: la operación está montada y apagada, esperando que la aprueben.
  motorTitulo: {
    es: "Esto es lo que preparamos",
    en: "This is what we set up",
  },
  motorBajada: {
    es: "Todavía no le escribe a nadie. Revísalo y enciéndelo.",
    en: "It isn't writing to anyone yet. Review it and turn it on.",
  },
  motorEncender: { es: "Aprobar y encender", en: "Approve and turn on" },
  motorEncendiendo: { es: "Encendiendo…", en: "Turning on…" },
  motorError: {
    es: "No se pudo encender. Prueba de nuevo.",
    en: "Couldn't turn it on. Try again.",
  },
  motorRevisarReglas: { es: "Revisar las reglas", en: "Review the rules" },
  motorApagadoTitulo: { es: "Riverz está apagado", en: "Riverz is off" },
  motorApagadoBajada: {
    es: "No sale ningún mensaje. Puedes encenderlo cuando quieras.",
    en: "No messages are going out. You can turn it on whenever you want.",
  },
  motorSuspendida: {
    es: "La cuenta está suspendida. Escríbenos para reactivarla.",
    en: "The account is suspended. Contact us to reactivate it.",
  },

  // Lo que se LEYÓ, dibujado en el banco.
  marcoCambiosSobre: { es: "Cambios sobre", en: "Changes to" },
  vistaDe: { es: "de", en: "of" },
  vistaSinFilas: { es: "No hay nada que mostrar.", en: "Nothing to show." },
  vistaSinDatos: { es: "Todavía no hay datos.", en: "No data yet." },
  vistaSinMensajes: { es: "No hay mensajes.", en: "No messages." },
  vistaPedido: { es: "Pedido", en: "Order" },
  vistaEnvio: { es: "Envío", en: "Shipping" },
  vistaTotal: { es: "Total", en: "Total" },

  // Los encabezados de lo que el Operador dibuja. Los lee una persona, así que
  // salen del catálogo; lo que devuelve `run()` lo lee el modelo y va en español.
  vTitMetricas: { es: "Cómo viene la cuenta", en: "How the account is doing" },
  vTitEnviarBorradoresMeta: { es: "Enviar borradores a Meta", en: "Submit drafts to Meta" },
  vQueEnviarBorradoresMeta: {
    es: "Envía los borradores seleccionados a revisión de Meta.",
    en: "Submits the selected drafts for Meta review.",
  },
  vTitAtribucion: { es: "Lo que vendió Riverz", en: "What Riverz sold" },
  vTitCortes: { es: "Quién atendió", en: "Who did the work" },
  vTitSalud: { es: "Cómo está la operación", en: "How the operation is doing" },
  vTitIntegraciones: { es: "Lo conectado", en: "What's connected" },
  vTitDiagnostico: { es: "Por qué no llegó", en: "Why it didn't arrive" },
  vConversaciones: { es: "Conversaciones", en: "Conversations" },
  vContactosNuevos: { es: "Contactos nuevos", en: "New contacts" },
  vResueltas: { es: "Resueltas", en: "Resolved" },
  vEntrantes: { es: "Mensajes recibidos", en: "Messages in" },
  vSalientes: { es: "Mensajes enviados", en: "Messages out" },
  vRespondioIa: { es: "Respondió la IA", en: "Answered by AI" },
  vPedidos: { es: "Pedidos", en: "Orders" },
  vFacturado: { es: "Facturado", en: "Revenue" },
  vProbada: { es: "Probada", en: "Proven" },
  vInfluida: { es: "Influida", en: "Assisted" },
  vCerroIa: { es: "Atendió la IA", en: "Handled by AI" },
  vCerroPersona: { es: "Atendió una persona", en: "Handled by a person" },
  vResolvioIa: { es: "Resolvió sola la IA", en: "AI resolved alone" },
  vPrimeraRespuesta: { es: "Primera respuesta", en: "First reply" },
  vFueraDeHorario: { es: "Fuera de horario", en: "Outside hours" },
  vSeAbstuvo: { es: "Se abstuvo", en: "Abstained" },
  vUltimosDias: { es: "Últimos {dias} días", en: "Last {dias} days" },
  vVentaTotal: { es: "Venta total", en: "Total sales" },
  vCorridas24h: { es: "Corridas de las últimas 24 h", en: "Runs in the last 24h" },
  vEsperandoAprobacion: { es: "Esperando aprobación", en: "Waiting for approval" },
  vTitHistorialConexion: { es: "Caídas y reconexiones", en: "Outages and reconnections" },
  vColCuando: { es: "Cuándo", en: "When" },
  vColCanal: { es: "Canal", en: "Channel" },
  vColPaso: { es: "Pasó de", en: "Went from" },
  vColMotivo: { es: "Motivo", en: "Reason" },
  vTitPedidos: { es: "Pedidos", en: "Orders" },
  vColPedido: { es: "Pedido", en: "Order" },
  vColCliente: { es: "Cliente", en: "Customer" },
  vColEstado: { es: "Estado", en: "Status" },
  vColTotal: { es: "Total", en: "Total" },
  vSinPedidos: { es: "No hay pedidos en este período.", en: "No orders in this period." },
  vTitLinkPago: { es: "Link de pago", en: "Payment link" },
  vTitCrearPedido: { es: "Pedido nuevo", en: "New order" },
  vLoQuePidio: { es: "Lo que pidió", en: "What they asked for" },
  vSinNombre: { es: "Sin nombre", en: "No name" },
  vDadoDeBaja: { es: "Se dio de baja", en: "Opted out" },
  vDadoDeBajaNota: {
    es: "Pidió no recibir más mensajes: no le va a llegar nada.",
    en: "Asked to stop receiving messages: nothing will reach them.",
  },
  vClienteDeLaTienda: { es: "Cliente de la tienda", en: "Store customer" },
  vColTelefono: { es: "Teléfono", en: "Phone" },
  vColEmail: { es: "Correo", en: "Email" },
  vColDonde: { es: "Dónde", en: "Where" },
  vColEtiquetas: { es: "Etiquetas", en: "Tags" },
  vColUltimoMensaje: { es: "Último mensaje", en: "Last message" },
  vColEsperando: { es: "Esperando", en: "Waiting" },
  vGastado: { es: "Gastado", en: "Lifetime spend" },
  vUltimaCompra: { es: "Última compra", en: "Last purchase" },
  vUltimoMensajeSuyo: { es: "Escribió", en: "Last wrote" },
  vUltimoProducto: { es: "Último producto", en: "Last product" },
  vDesde: { es: "Contacto desde", en: "Contact since" },
  vSinContactos: { es: "No hay contactos que coincidan.", en: "No matching contacts." },
  vSinConversaciones: { es: "No hay conversaciones.", en: "No conversations." },
  vTitBorradores: { es: "Esperando que las mandes", en: "Waiting to be sent" },
  vColProducto: { es: "Producto", en: "Product" },
  vColTipo: { es: "Tipo", en: "Type" },
  vColMaterial: { es: "Material", en: "Material" },
  vColPrecio: { es: "Precio", en: "Price" },
  vColOrigen: { es: "Origen", en: "Source" },
  vColPreguntas: { es: "Preguntas frecuentes", en: "FAQs" },
  vColQueDecir: { es: "Qué decir", en: "What to say" },
  vColQueNoDecir: { es: "Qué no decir", en: "What not to say" },
  vColDescripcion: { es: "Descripción", en: "Description" },
  vColNotas: { es: "Notas", en: "Notes" },
  vSi: { es: "Sí", en: "Yes" },
  vNo: { es: "No", en: "No" },
  vTemaDeSalud: { es: "Tema de salud", en: "Health-sensitive" },
  vSinProductos: { es: "No hay productos.", en: "No products." },
  vSinMaterial: {
    es: "Sin material cargado: el agente improvisa cuando le preguntan por él.",
    en: "No material loaded: the agent improvises when asked about it.",
  },
  vColResultado: { es: "Resultado", en: "Outcome" },
  vColResumen: { es: "Resumen", en: "Summary" },
  vColDuracion: { es: "Duración", en: "Length" },
  vColGrabacion: { es: "Grabación", en: "Recording" },
  vColCampana: { es: "Campaña", en: "Campaign" },
  vColLlamadas: { es: "Llamadas", en: "Calls" },
  vColFaltan: { es: "Faltan", en: "Left" },
  vTitCampanasVoz: { es: "Campañas de llamadas", en: "Call campaigns" },
  vSinLlamadas: { es: "No hay llamadas.", en: "No calls." },
  vSinCampanasVoz: { es: "No hay campañas de llamadas.", en: "No call campaigns." },
  vColRespuesta: { es: "Respuesta", en: "Answer" },
  vQueDesconectar: {
    es: "Corta el canal para toda la cuenta.",
    en: "Cuts the channel for the whole account.",
  },
  vDesconectarAviso: {
    es: "Volver exige reconectar desde el navegador, con la cuenta del comercio.",
    en: "Coming back requires reconnecting from the browser, with the store's account.",
  },
  vQuePrenderReglaComentario: {
    es: "Empieza a contestar los comentarios que coincidan.",
    en: "It starts replying to matching comments.",
  },
  vQueApagarReglaComentario: {
    es: "Deja de contestar comentarios.",
    en: "It stops replying to comments.",
  },
  vQueResponderHueco: {
    es: "Desde la próxima respuesta, el agente cita esto.",
    en: "From the next reply on, the agent quotes this.",
  },
  vColQue: { es: "Qué", en: "What" },
  vSinAprobaciones: { es: "No hay nada esperando.", en: "Nothing is waiting." },
  vQueAprobar: {
    es: "Ejecuta lo que estaba esperando.",
    en: "Executes what was waiting.",
  },
  vQueRechazar: {
    es: "No se hace nada.",
    en: "Nothing happens.",
  },
  vAprobarAviso: {
    es: "Puede cobrar un pedido, y eso no se deshace.",
    en: "It may charge an order, and that can't be undone.",
  },
  vTitAudiencia: { es: "A cuánta gente se le puede escribir hoy", en: "Who can be messaged today" },
  vColAQuien: { es: "A quién", en: "To whom" },
  vColAlcance: { es: "Alcance", en: "Reach" },
  vColControl: { es: "Control", en: "Holdout" },
  vColMensaje: { es: "Mensaje", en: "Message" },
  vColOferta: { es: "Oferta", en: "Offer" },
  vAlcanzables: { es: "Alcanzables ahora", en: "Reachable now" },
  vSuscriptores: { es: "Suscriptores", en: "Subscribers" },
  vComentaristas: { es: "Comentaron (7 d)", en: "Commented (7d)" },
  vDm24h: { es: "Escribieron (24 h)", en: "Wrote (24h)" },
  vEnvioFrenado: { es: "El envío está frenado.", en: "Sending is blocked." },
  vCampanaNaceApagada: {
    es: "Nace apagada: no sale ningún mensaje hasta que se lance.",
    en: "It starts off: no message goes out until it's launched.",
  },
  vQueLanzarProspeccion: {
    es: "Empieza a mandarle el mensaje privado a la audiencia.",
    en: "Starts sending the DM to the audience.",
  },
  vTitAsignar: { es: "Asignar la conversación", en: "Assign the conversation" },
  vTitCerrar: { es: "Cerrar la conversación", en: "Close the conversation" },
  vTitReabrir: { es: "Reabrir la conversación", en: "Reopen the conversation" },
  vTitIaConversacion: { es: "La IA en esta conversación", en: "The AI in this conversation" },
  vColPidioHumano: { es: "Pidió una persona", en: "Asked for a person" },
  vColNoContestoPorque: { es: "La IA no contestó porque", en: "The AI didn't reply because" },
  vColCheckoutPendiente: { es: "Pago a medias", en: "Unfinished checkout" },
  vColSatisfaccion: { es: "Nota que dejó", en: "Rating they left" },
  vIaApagada: { es: "IA apagada", en: "AI off" },
  vDeAnuncio: { es: "Vino de un anuncio", en: "Came from an ad" },
  vAsignadaA: { es: "La tiene", en: "Handled by" },
  vDesasignar: { es: "La deja sin asignar.", en: "Leaves it unassigned." },
  vQueCerrar: {
    es: "El hilo sale de la bandeja. Vuelve si el cliente escribe.",
    en: "The thread leaves the inbox. It comes back if the customer writes.",
  },
  vQueReabrir: {
    es: "El hilo vuelve a la bandeja.",
    en: "The thread comes back to the inbox.",
  },
  vQuePrenderIaConv: {
    es: "La IA vuelve a contestar en este hilo.",
    en: "The AI answers in this thread again.",
  },
  vQueApagarIaConv: {
    es: "La IA deja de contestar en este hilo.",
    en: "The AI stops answering in this thread.",
  },
  vApagarIaConvAviso: {
    es: "Queda en manos de una persona: si nadie lo mira, ese cliente no recibe nada.",
    en: "It's left to a person: if nobody looks, that customer gets nothing.",
  },
  vTitEnlaces: { es: "Enlaces que mandó Riverz", en: "Links Riverz sent" },
  vColDestinatarios: { es: "Destinatarios", en: "Recipients" },
  vEntregados: { es: "Entregados", en: "Delivered" },
  vLeidos: { es: "Leídos", en: "Read" },
  vColADonde: { es: "A dónde", en: "Where to" },
  vColUltimoClick: { es: "Último click", en: "Last click" },
  vColClicks: { es: "Clicks", en: "Clicks" },
  vSinEnlaces: { es: "No hay enlaces.", en: "No links." },
  vQueLanzar: {
    es: "Manda la campaña a todos los destinatarios.",
    en: "Sends the campaign to every recipient.",
  },
  vLanzarAviso: {
    es: "Sale a todos de una vez y no hay forma de volver atrás.",
    en: "It goes to everyone at once and there's no way back.",
  },
  vTitCarritos: { es: "Carritos abandonados", en: "Abandoned carts" },
  vTitPagosRechazados: { es: "Pagos rechazados", en: "Rejected payments" },
  vTitEntregas: { es: "Lo que llegó", en: "What was delivered" },
  vTitRegistrarPago: { es: "Dar el pedido por cobrado", en: "Mark the order as paid" },
  vColSeLeEscribio: { es: "Se le escribió", en: "Contacted" },
  vColPorQue: { es: "Por qué", en: "Why" },
  vColEntregado: { es: "Entregado", en: "Delivered" },
  vColOpinion: { es: "Le preguntamos", en: "Asked for feedback" },
  vCompro: { es: "Compró", en: "Bought" },
  vRecuperado: { es: "Recuperado", en: "Recovered" },
  vSinCarritos: { es: "No hay carritos abandonados.", en: "No abandoned carts." },
  vSinPagosRechazados: { es: "No hay pagos rechazados.", en: "No rejected payments." },
  vSinEntregas: { es: "No hay entregas.", en: "No deliveries." },
  vQueRegistrarPago: {
    es: "Deja de mandarle recordatorios de pago.",
    en: "Stops sending them payment reminders.",
  },
  vRegistrarPagoAviso: {
    es: "Si no se puede confirmar, le preguntamos al dueño por WhatsApp.",
    en: "If it can't be confirmed, we ask the owner over WhatsApp.",
  },
  vTitEsperandoRespuesta: { es: "Esperando respuesta", en: "Waiting for a reply" },
  vTitEnviar: { es: "Mensaje a un cliente", en: "Message to a customer" },
  vMensaje: { es: "Mensaje", en: "Message" },
  vCorrida: { es: "Corrida", en: "Run" },
  vSinPendientesBandeja: {
    es: "No hay nadie esperando respuesta.",
    en: "Nobody is waiting for a reply.",
  },
  vEnviarAviso: {
    es: "Se manda al aprobar. Un mensaje enviado no vuelve.",
    en: "It sends on approval. A sent message can't be taken back.",
  },
  vQueAprobarBorrador: {
    es: "Manda la respuesta que escribió la IA.",
    en: "Sends the reply the AI wrote.",
  },
  vQueDescartarBorrador: {
    es: "Descarta la respuesta: no se manda nada.",
    en: "Discards the reply: nothing is sent.",
  },
  vTitTrabadas: { es: "Dónde se traba la gente", en: "Where people get stuck" },
  vTitCorridas: { es: "Corridas de menús", en: "Menu runs" },
  vColPasoActual: { es: "Paso", en: "Step" },
  vSinFlujos: { es: "No hay menús.", en: "No menus." },
  vSinCorridas: { es: "No hay corridas.", en: "No runs." },
  vQuePrenderFlujo: {
    es: "Desde ahora se le muestra a los clientes que lo disparen.",
    en: "From now on it shows to customers who trigger it.",
  },
  vQuePausarFlujo: {
    es: "Deja de mostrarse.",
    en: "It stops showing.",
  },
  vTitReclamos: { es: "Reclamos abiertos", en: "Open claims" },
  vTitDevoluciones: { es: "Devoluciones", en: "Returns" },
  vTitHuecos: { es: "Lo que la IA no supo contestar", en: "What the AI couldn't answer" },
  vTitAtajos: { es: "Respuestas rápidas", en: "Quick replies" },
  vTitFiltros: { es: "Filtros guardados", en: "Saved filters" },
  vTitReparto: { es: "A quién le toca", en: "Who gets what" },
  vTitDecidirDevolucion: { es: "Decidir la devolución", en: "Decide the return" },
  vColEtapa: { es: "Etapa", en: "Stage" },
  vColVence: { es: "Vence", en: "Due" },
  vColPregunta: { es: "Pregunta", en: "Question" },
  vColQueFalta: { es: "Qué falta", en: "What's missing" },
  vColAtajo: { es: "Atajo", en: "Shortcut" },
  vColTexto: { es: "Texto", en: "Text" },
  vResuelto: { es: "Resuelto", en: "Resolved" },
  vSinResolver: { es: "Sin resolver", en: "Unresolved" },
  vSinReclamos: { es: "No hay reclamos abiertos.", en: "No open claims." },
  vSinDevoluciones: { es: "No hay devoluciones.", en: "No returns." },
  vSinHuecos: {
    es: "La IA supo contestar todo.",
    en: "The AI answered everything.",
  },
  vSinAtajos: { es: "No hay respuestas rápidas.", en: "No quick replies." },
  vSinFiltros: { es: "No hay filtros guardados.", en: "No saved filters." },
  vQuePrenderReparto: {
    es: "Desde ahora reparte las conversaciones que le toquen.",
    en: "From now on it routes the conversations it matches.",
  },
  vQueApagarReparto: {
    es: "Deja de repartir: las conversaciones quedan sin asignar.",
    en: "It stops routing: conversations are left unassigned.",
  },
  vQueCrearAtajo: {
    es: "Queda para escribirlo con una barra en la bandeja.",
    en: "It becomes available by typing a slash in the inbox.",
  },
  vDecidirDevolucionAviso: {
    es: "Le llega al cliente.",
    en: "The customer is notified.",
  },
  vTitSegmentos: { es: "Segmentos", en: "Segments" },
  vTitAlcance: { es: "A cuánta gente alcanza", en: "How many people it reaches" },
  vTitNota: { es: "Nota en la ficha", en: "Note on the record" },
  vColCriterios: { es: "Criterios", en: "Criteria" },
  vSinEtiquetas: { es: "No hay etiquetas.", en: "No tags." },
  vSinSegmentos: { es: "No hay segmentos.", en: "No segments." },
  vQuePonerEtiqueta: {
    es: "Le pone esta etiqueta a todo el público elegido.",
    en: "Adds this tag to everyone in the selected audience.",
  },
  vQueQuitarEtiqueta: {
    es: "Le saca esta etiqueta a todo el público elegido.",
    en: "Removes this tag from everyone in the selected audience.",
  },
  vQueNota: {
    es: "Queda en la ficha del contacto. La lee el equipo, no el cliente.",
    en: "It stays on the contact's record. The team reads it, not the customer.",
  },
  vQueCrearEtiqueta: {
    es: "Crea la etiqueta para poder usarla en segmentos y filtros.",
    en: "Creates the tag so it can be used in segments and filters.",
  },
  vQueBorrarEtiqueta: {
    es: "Borra la etiqueta de la cuenta.",
    en: "Deletes the tag from the account.",
  },
  vBorrarEtiquetaAviso: {
    es: "Se le saca a todos los contactos que la tenían.",
    en: "It's removed from every contact that had it.",
  },
  vTitReglasNegocio: { es: "Reglas del negocio", en: "Business rules" },
  vTitDescuentos: { es: "Descuentos que dio la IA", en: "Discounts the AI gave" },
  vTitPrenderAgente: { es: "Poner el agente a atender", en: "Put the agent to work" },
  vTitPausarAgente: { es: "Pausar el agente", en: "Pause the agent" },
  vColCuandoAplica: { es: "Cuándo aplica", en: "When it applies" },
  vColQueHace: { es: "Qué hace", en: "What it does" },
  vColPara: { es: "Para", en: "For" },
  vColCodigo: { es: "Código", en: "Code" },
  vColUsado: { es: "Usado", en: "Redeemed" },
  vColDescuento: { es: "Descuento", en: "Discount" },
  vAtendiendo: { es: "Atendiendo", en: "Working" },
  vPausado: { es: "Pausado", en: "Paused" },
  vSinAgentes: { es: "No hay agentes.", en: "No agents." },
  vSinDescuentos: { es: "La IA no dio ningún descuento.", en: "The AI gave no discounts." },
  vQuePrenderAgente: {
    es: "Desde ahora contesta los mensajes que le tocan.",
    en: "From now on it answers the messages assigned to it.",
  },
  vQuePausarAgente: {
    es: "Deja de contestar: los mensajes quedan para una persona.",
    en: "It stops answering: messages are left for a person.",
  },
  vQueCrearRegla: {
    es: "Una regla que los agentes obedecen en cada respuesta.",
    en: "A rule the agents obey in every reply.",
  },
  vReglaNaceApagada: {
    es: "Nace apagada: hay que prenderla para que rija.",
    en: "It starts off: turn it on for it to apply.",
  },
  vQuePrenderRegla: {
    es: "Los agentes la obedecen desde el próximo mensaje.",
    en: "Agents obey it from the next message on.",
  },
  vQueApagarRegla: {
    es: "Los agentes dejan de obedecerla.",
    en: "Agents stop obeying it.",
  },
  vTitEnCola: { es: "Lo que está por salir", en: "What's about to go out" },
  vTitRecetas: { es: "Automatizaciones listas para usar", en: "Ready-made automations" },
  vTitPrender: { es: "Prender la automatización", en: "Turn the automation on" },
  vTitPausar: { es: "Pausar la automatización", en: "Pause the automation" },
  vTitCancelarEspera: { es: "Cancelar un mensaje en cola", en: "Cancel a queued message" },
  vColDispara: { es: "Dispara con", en: "Triggered by" },
  vColCorridas: { es: "Corridas", en: "Runs" },
  vColUltima: { es: "Última", en: "Last" },
  vColSale: { es: "Sale", en: "Goes out" },
  vColNecesita: { es: "Necesita", en: "Requires" },
  vPausadaPeroSale: { es: "Pausada, pero sale", en: "Paused, still going out" },
  vSinAutomatizaciones: { es: "No hay automatizaciones.", en: "No automations." },
  vSinCola: { es: "No hay nada esperando para salir.", en: "Nothing queued to go out." },
  vQuePrender: {
    es: "Desde ahora le escribe a los clientes que la disparen.",
    en: "From now on it writes to customers who trigger it.",
  },
  vQuePausar: {
    es: "Deja de dispararse con clientes nuevos.",
    en: "Stops triggering for new customers.",
  },
  vPausarNoFrenaCola: {
    es: "Lo que ya está en cola sale igual: se cancela uno por uno.",
    en: "What's already queued still goes out: cancel it one by one.",
  },
  vQueCancelarEspera: {
    es: "Ese cliente no recibe el mensaje que le iba a llegar.",
    en: "That customer doesn't get the message that was on its way.",
  },
  vCancelarEsperaAviso: {
    es: "No se puede volver a poner en cola.",
    en: "It can't be re-queued.",
  },
  vColCategoria: { es: "Categoría", en: "Category" },
  vColFallidos: { es: "Fallidos", en: "Failed" },
  vColRespuestas: { es: "Respuestas", en: "Replies" },
  vSinPlantillas: { es: "No hay plantillas.", en: "No templates." },
  vSinCampanas: { es: "No hay campañas.", en: "No campaigns." },
  vTitSaldo: { es: "Saldo de la cuenta", en: "Account balance" },
  vTitPlan: { es: "Plan", en: "Plan" },
  vTitRenombrar: { es: "Renombrar la cuenta", en: "Rename the account" },
  vTitZonaHoraria: { es: "Zona horaria", en: "Time zone" },
  vSaldo: { es: "Saldo", en: "Balance" },
  vCargado: { es: "Cargado", en: "Topped up" },
  vGastadoPeriodo: { es: "Gastado", en: "Spent" },
  vRecargaAutomatica: { es: "Recarga automática", en: "Auto top-up" },
  vCortaSinSaldo: {
    es: "Sin saldo se corta la operación.",
    en: "With no balance the operation stops.",
  },
  vQuedaDebiendo: {
    es: "Sin saldo queda debiendo, no se corta.",
    en: "With no balance it goes negative, it doesn't stop.",
  },
  vTratoPropio: { es: "Precio propio", en: "Custom price" },
  vIncluidas: { es: "Incluidas", en: "Included" },
  vExcedente: { es: "Excedente", en: "Overage" },
  vPeriodo: { es: "Período hasta", en: "Period ends" },
  vPruebaHasta: { es: "Prueba hasta", en: "Trial until" },
  vCobroFallando: { es: "El cobro viene fallando desde", en: "Payment failing since" },
  vZonaHoraria: { es: "Zona horaria", en: "Time zone" },
  vDueno: { es: "dueño", en: "owner" },
  vInvitacionPendiente: { es: "invitación sin aceptar", en: "invite not accepted" },
  vColNombre: { es: "Nombre", en: "Name" },
  vQueRenombrar: {
    es: "Cambia el nombre que ve todo el equipo.",
    en: "Changes the name the whole team sees.",
  },
  vQueZonaHoraria: {
    es: "Cambia dónde se cortan los días en los informes.",
    en: "Changes where days break in reports.",
  },
  vInvitarAviso: {
    es: "Le llega un correo con el enlace para entrar.",
    en: "They get an email with the link to join.",
  },
  vTitPendientes: { es: "Comentarios sin contestar", en: "Unanswered comments" },
  vTitAjustesComentarios: { es: "Respuesta a comentarios", en: "Comment replies" },
  vTitReglasComentarios: { es: "Reglas de comentarios", en: "Comment rules" },
  vTitPublicaciones: { es: "Dónde comenta la gente", en: "Where people comment" },
  vTitModerar: { es: "Moderar un comentario", en: "Moderate a comment" },
  vColPersona: { es: "Quién", en: "Who" },
  vColComentario: { es: "Comentario", en: "Comment" },
  vColRegla: { es: "Regla", en: "Rule" },
  vColAtiende: { es: "Atiende", en: "Applies to" },
  vColEnviados: { es: "Enviados", en: "Sent" },
  vColPublicacion: { es: "Publicación", en: "Post" },
  vColQueMuestra: { es: "Qué muestra", en: "What it shows" },
  vColAnuncio: { es: "Anuncio", en: "Ad" },
  vOculto: { es: "Oculto", en: "Hidden" },
  vYaLeEscribio: { es: "Ya le escribió por privado", en: "Already DM'd" },
  vLaCuenta: { es: "La cuenta", en: "The account" },
  vContestaConIa: { es: "Contesta la IA", en: "AI replies" },
  vQuePublica: { es: "Qué publica", en: "What it posts" },
  vTopePorHilo: { es: "Tope por hilo", en: "Cap per thread" },
  vEncendida: { es: "Encendida", en: "On" },
  vApagada: { es: "Apagada", en: "Off" },
  vSinPendientes: { es: "No hay comentarios sin contestar.", en: "No unanswered comments." },
  vSinComentarios: { es: "No hay comentarios.", en: "No comments." },
  vSinReglas: { es: "No hay reglas.", en: "No rules." },
  vSinPublicaciones: { es: "No hay publicaciones.", en: "No posts." },
  vBorrarNoVuelve: {
    es: "Borrarlo no se deshace: el comentario desaparece de la publicación.",
    en: "Deleting can't be undone: the comment disappears from the post.",
  },
  vQueConfigurar: {
    es: "Cambia cómo Riverz contesta los comentarios.",
    en: "Changes how Riverz replies to comments.",
  },
  vTitLlamar: { es: "Llamada saliente", en: "Outbound call" },
  vLlamarAviso: {
    es: "Le va a sonar el teléfono. Una llamada hecha no se deshace.",
    en: "Their phone will ring. A placed call can't be undone.",
  },
  vQueEditarProducto: {
    es: "Cambia lo que el agente cita de este producto.",
    en: "Changes what the agent quotes about this product.",
  },
  vPrecioDeLaTienda: {
    es: "El precio y el stock salen de la tienda al aprobar.",
    en: "Price and stock come from the store on approval.",
  },
  domRasmiaw: { es: 'Rasmiaw', en: 'Rasmiaw' },
  haciendoRasmiaw: { es: 'Preparando Rasmiaw', en: 'Preparing Rasmiaw' },
  rasmiawPreparar: { es: 'Preparar las automatizaciones existentes de Rasmiaw', en: 'Prepare existing Rasmiaw automations' },
  rasmiawPausadas: { es: 'Los flujos quedan preparados y apagados.', en: 'Flows remain prepared and switched off.' },
  rasmiawPreparacion: { es: 'Preparación de Rasmiaw', en: 'Rasmiaw readiness' },
  rasmiawListo: { es: 'Listo', en: 'Ready' },
  rasmiawPendiente: { es: 'Pendiente', en: 'Pending' },
  rasmiawPlantillas: { es: 'Plantillas aprobadas', en: 'Approved templates' },
  rasmiawFlujos: { es: 'Flujos preparados', en: 'Prepared flows' },
  operatorSaldoInsuficiente: { es: 'Saldo insuficiente. Recarga tu billetera para continuar.', en: 'Insufficient balance. Top up your wallet to continue.' },
  operatorSuscripcionVencida: { es: 'Renueva tu suscripción para continuar.', en: 'Renew your subscription to continue.' },
  operatorSinPagar: { es: 'La IA se activa cuando se complete el pago.', en: 'The AI turns on once the payment is completed.' },
  planPasosListos: { es: '**{n}** pasos listos', en: '**{n}** steps completed' },
  planPasoListo: { es: '**{n}** paso listo', en: '**{n}** step completed' },
  planPasosFallidos: { es: '**{n}** pasos fallidos', en: '**{n}** steps failed' },
  planPasoFallido: { es: '**{n}** paso fallido', en: '**{n}** step failed' },
  planPasosSaltados: { es: '**{n}** pasos sin intentar', en: '**{n}** steps skipped' },
  planPasoSaltado: { es: '**{n}** paso sin intentar', en: '**{n}** step skipped' },
  planParcial: { es: 'Completado parcialmente', en: 'Partially completed' },
  planFallido: { es: 'No se completó', en: 'Not completed' },
} satisfies Namespace;
