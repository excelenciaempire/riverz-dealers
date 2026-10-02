import type { Namespace } from "./types";

/**
 * Chat web — la página de configuración del widget que el comercio instala en
 * su tienda. Todo lo de acá lo lee el comercio en el panel.
 *
 * Los controles de pedidos del visitante también se resuelven aquí, usando
 * el idioma del widget explícitamente, sin la cookie de quien administra.
 */
export const webchat = {
  ordersTitle: { es: 'Mis pedidos', en: 'My orders' },
  ordersLoading: { es: 'Cargando…', en: 'Loading…' },
  ordersEmpty: { es: 'No hay pedidos vinculados a este chat.', en: 'No orders are linked to this chat.' },
  ordersMore: { es: 'Ver anteriores', en: 'Show older orders' },
  orderUnavailable: { es: 'No se pudieron consultar los pedidos. Intenta de nuevo.', en: 'Orders could not be loaded. Try again.' },
  orderNotAvailable: { es: 'Esta función no está disponible.', en: 'This feature is unavailable.' },
  orderInvalid: { es: 'La solicitud de pedidos no es válida.', en: 'The order request is invalid.' },
  orderAction: { es: 'Solicitud', en: 'Request' },
  orderAction_confirm: { es: 'Confirmar pedido', en: 'Confirm order' },
  orderAction_address: { es: 'Corregir dirección', en: 'Correct address' },
  orderAction_variant: { es: 'Cambiar talla o color', en: 'Change size or color' },
  orderAction_cancel: { es: 'Solicitar cancelación', en: 'Request cancellation' },
  orderDetails_address: { es: 'Dirección completa', en: 'Full address' },
  orderDetails_variant: { es: 'Producto, talla o color deseados', en: 'Product, size or color requested' },
  orderDetails_cancel: { es: 'Motivo', en: 'Reason' },
  orderSendRequest: { es: 'Enviar solicitud', en: 'Send request' },
  orderRequest_confirm: { es: 'Quiero confirmar que recibiré el pedido {order}. Revisa si todavía puede confirmarse.', en: 'I want to confirm that I will receive order {order}. Check whether it can still be confirmed.' },
  orderRequest_address: { es: 'Solicito corregir la dirección del pedido {order}. Esta es la dirección que quiero que revises:', en: 'I request an address correction for order {order}. This is the address I want you to review:' },
  orderRequest_variant: { es: 'Solicito cambiar la talla o el color en el pedido {order}. Quiero que revises este cambio:', en: 'I request a size or color change for order {order}. Please review this change:' },
  orderRequest_cancel: { es: 'Solicito cancelar el pedido {order}. Este es el motivo:', en: 'I request cancellation of order {order}. This is the reason:' },
  title: { es: "Chat web", en: "Web chat" },
  subtitle: {
    es: "El chat de tu tienda, atendido por tu agente.",
    en: "Your store's chat, handled by your agent.",
  },

  // ── Estado ──
  enable: { es: "Chat web activo", en: "Web chat live" },
  live: { es: "Activo", en: "Live" },
  off: { es: "Apagado", en: "Off" },
  readyCount: {
    es: "Configuración {done}/{total}",
    en: "Setup {done}/{total}",
  },
  // ── Instalación ──
  install: { es: "Instalación", en: "Install" },
  installManual: { es: "Pegar el código a mano", en: "Paste the code manually" },
  installNeedsReconnect: {
    es: "Reconecta Shopify para poder instalarlo desde aquí.",
    en: "Reconnect Shopify to install it from here.",
  },
  reconnectShopify: { es: "Reconectar Shopify", en: "Reconnect Shopify" },
  installNeedsShopify: {
    es: "Conecta Shopify para instalarlo automáticamente.",
    en: "Connect Shopify to install it automatically.",
  },
  installAuto: { es: "Instalar en la tienda", en: "Install on the store" },
  installAutoHint: {
    es: "Actívalo en el editor del tema y guarda el cambio.",
    en: "Enable it in the theme editor and save the change.",
  },
  openThemeEditor: { es: "Abrir Shopify", en: "Open Shopify" },
  embedPrepared: {
    es: "El chat está listo para activarse en Shopify.",
    en: "The chat is ready to enable in Shopify.",
  },
  installAutoOn: {
    es: "Ya está puesto en tu tienda.",
    en: "It is already live on your store.",
  },
  installNow: { es: "Instalar", en: "Install" },
  uninstall: { es: "Quitar", en: "Remove" },
  installedOk: { es: "Listo, el chat ya está en tu tienda.", en: "Done, the chat is live on your store." },
  uninstalledOk: { es: "Lo sacamos de tu tienda.", en: "Removed from your store." },
  installFailed: { es: "No se pudo instalar.", en: "Could not install." },
  copy: { es: "Copiar", en: "Copy" },
  copied: { es: "Copiado", en: "Copied" },
  domains: { es: "Dominios permitidos", en: "Allowed domains" },
  domainsEmpty: {
    es: "Sin al menos uno, el chat no abre en ninguna página.",
    en: "Without at least one, the chat won't open anywhere.",
  },
  domainsDetected: { es: "De tu tienda:", en: "From your store:" },
  // Las dos razones por las que el codigo esta pegado y el chat no aparece.
  whyOff: {
    es: "El chat está apagado: aunque el código esté puesto, no aparece en la tienda.",
    en: "The chat is off: even with the code in place, it won't show on the store.",
  },
  whyNoDomains: {
    es: "Falta el dominio de tu tienda. Sin él el chat no abre en ninguna página.",
    en: "Your store domain is missing. Without it the chat won't open anywhere.",
  },
  // La tercera forma de estar "activo" y no contestar: el chat es la boca, el
  // agente es quien piensa. Sin un agente encendido el mensaje entra a la
  // bandeja y ahi se queda.
  whyNoAgent: {
    es: "El chat abre, pero no hay ningún agente encendido: los mensajes entran a la bandeja y nadie los contesta.",
    en: "The chat opens, but no agent is on: messages land in the inbox and nobody answers them.",
  },
  whyAgentPaused: {
    es: "El agente que elegiste está en pausa: el chat abre y nadie contesta.",
    en: "The agent you picked is paused: the chat opens and nobody answers.",
  },
  whyNoAgentCta: { es: "Encender", en: "Turn it on" },
  domainAdd: { es: "Agregar dominio", en: "Add domain" },
  domainPlaceholder: { es: "mitienda.com", en: "mystore.com" },

  // ── Apariencia ──
  appearance: { es: "Apariencia", en: "Appearance" },
  color: { es: "Color", en: "Color" },
  position: { es: "Posición", en: "Position" },
  positionRight: { es: "Derecha", en: "Right" },
  positionLeft: { es: "Izquierda", en: "Left" },
  brandName: { es: "Nombre visible", en: "Display name" },
  greeting: { es: "Saludo", en: "Greeting" },
  greetingPlaceholder: {
    es: "Hola, ¿en qué te ayudo?",
    en: "Hi, how can I help?",
  },
  avatar: { es: "Imagen", en: "Image" },
  imageUpload: { es: "Subir imagen", en: "Upload image" },
  imageRemove: { es: "Quitar imagen", en: "Remove image" },
  imageBadType: { es: "Usa PNG, JPG, WEBP o GIF.", en: "Use PNG, JPG, WEBP or GIF." },
  imageTooLarge: {
    es: "La imagen no puede pasar de 2 MB.",
    en: "The image can't be over 2 MB.",
  },
  imageFailed: { es: "No se pudo subir la imagen.", en: "Couldn't upload the image." },

  // ── Vista previa ──
  preview: { es: "Vista previa", en: "Preview" },
  previewComposer: { es: "Escribe tu mensaje", en: "Type your message" },
  previewOpen: { es: "Abierto", en: "Open" },
  previewClosed: { es: "Cerrado", en: "Closed" },
  previewAi: { es: "IA", en: "AI" },
  try: { es: "Probar el chat", en: "Try the chat" },
  tryHint: {
    es: "Escribes como un cliente y la conversación entra a la bandeja.",
    en: "You write as a customer and the conversation lands in the inbox.",
  },
  tryFailed: { es: "No se pudo abrir el chat.", en: "Couldn't open the chat." },

  // ── Píxel de Meta ──
  // El chat le cuenta a Meta dos cosas: quién empezó a conversar y quién
  // compró. Sin el píxel conectado, las dos se pierden.
  pixel: { es: "Píxel de Meta", en: "Meta Pixel" },
  pixelOff: {
    es: "Sin conectar, Meta no ve las conversaciones ni las ventas del chat.",
    en: "Without it, Meta never sees the chat's conversations or sales.",
  },
  pixelReported: {
    es: "{contacts} conversaciones y {sales} ventas informadas",
    en: "{contacts} conversations and {sales} sales reported",
  },
  pixelConnect: { es: "Conectar", en: "Connect" },
  quickReplies: { es: "Preguntas sugeridas", en: "Suggested questions" },
  quickRepliesHint: {
    es: "Hasta 4. Desaparecen cuando arranca la conversación.",
    en: "Up to 4. They disappear once the conversation starts.",
  },
  quickReplyPlaceholder: {
    es: "¿Dónde está mi pedido?",
    en: "Where is my order?",
  },

  // ── Invitación ──
  proactive: { es: "Salir a buscar", en: "Reach out" },
  proactiveMessage: { es: "Texto de la invitación", en: "Invitation text" },
  proactiveMessageHint: {
    es: "Con texto aparece una burbuja junto al botón. Vacío, el chat se abre solo.",
    en: "With text, a bubble shows next to the button. Empty, the chat opens by itself.",
  },
  proactiveMessagePlaceholder: {
    es: "¿Te ayudo a elegir?",
    en: "Need help choosing?",
  },
  proactiveExit: { es: "Cuando el cursor va a salir", en: "When the cursor leaves" },
  proactiveExitHint: {
    es: "Solo en computadora: en el teléfono ese gesto no existe.",
    en: "Desktop only: that gesture does not exist on a phone.",
  },
  proactiveScroll: { es: "Al leer la página", en: "After reading the page" },
  proactiveScrollNever: { es: "Nunca", en: "Never" },
  proactiveUrls: { es: "Solo en estas páginas", en: "Only on these pages" },
  proactiveUrlsHint: {
    es: "Trozos de dirección, como /products/. Vacío: en todas.",
    en: "Parts of the address, like /products/. Empty: everywhere.",
  },
  proactiveUrlPlaceholder: { es: "/products/", en: "/products/" },

  // ── Comportamiento ──
  behavior: { es: "Asistente IA", en: "AI assistant" },

  // Con que contesta. El chat no responde con lo que sabe un modelo: responde
  // con la ficha que el comercio cargo producto por producto.
  knowledge: { es: "Con qué contesta", en: "What it answers with" },
  knowledgeReady: {
    es: "{done} de {total} productos con ficha cargada",
    en: "{done} of {total} products have a knowledge sheet",
  },
  knowledgeGap: {
    es: "A los otros {n} los contesta solo con el título y el precio.",
    en: "The other {n} it answers with just the title and the price.",
  },
  knowledgeAll: {
    es: "Todo el catálogo tiene ficha.",
    en: "Every product has a sheet.",
  },
  knowledgeEmpty: {
    es: "Sin productos cargados, el chat contesta sin saber qué vendes.",
    en: "With no products loaded, the chat answers without knowing what you sell.",
  },
  knowledgeFill: { es: "Completar", en: "Fill them in" },
  // La ventaja del canal: quien escribe esta parado en una ficha.
  knowledgePage: {
    es: "Y si escribe desde la página de un producto, el chat carga esa ficha sin que tenga que nombrarlo.",
    en: "And when someone writes from a product page, the chat loads that sheet without them naming it.",
  },
  agent: { es: "Agente que atiende", en: "Agent on duty" },
  agentAuto: { es: "El que corresponda", en: "Whichever applies" },
  agentPaused: { es: "en pausa", en: "paused" },
  requireEmail: { es: "Pedir correo antes de escribir", en: "Ask for email first" },
  requireEmailHint: {
    es: "Suma fricción. Si compra, el correo se captura igual.",
    en: "Adds friction. On purchase, the email is captured anyway.",
  },
  requireContact: { es: "Pedir datos antes de escribir", en: "Ask for details first" },
  requireContactHint: {
    es: "Cada campo cuesta conversaciones. Con el teléfono puedes escribirle si no compró.",
    en: "Every field costs conversations. With a phone you can follow up if they didn't buy.",
  },
  pedirNada: { es: "No pedir nada", en: "Ask for nothing" },
  pedirCorreo: { es: "Correo", en: "Email" },
  pedirTelefono: { es: "Teléfono", en: "Phone" },
  pedirAmbos: { es: "Correo y teléfono", en: "Email and phone" },
  uploads: { es: "Recibir fotos y archivos", en: "Accept photos and files" },
  askRating: { es: "Preguntar si sirvió", en: "Ask if it helped" },
  askRatingHint: {
    es: "De aquí sale el porcentaje de abajo.",
    en: "This is where the percentage below comes from.",
  },
  offlineMessage: { es: "Fuera de horario", en: "Outside business hours" },
  offlinePlaceholder: {
    es: "Ahora no estamos, te respondemos apenas abramos.",
    en: "We are away right now, we will reply as soon as we open.",
  },
  autoOpen: { es: "Abrirse solo", en: "Open by itself" },
  autoOpenNever: { es: "Nunca", en: "Never" },

  // ── Resultados ──
  results: { es: "Resultados", en: "Results" },
  resultsSummary: {
    es: "{conversations} conversaciones · {rate}% por IA",
    en: "{conversations} conversations · {rate}% by AI",
  },
  resultsSummaryNoRate: {
    es: "{conversations} conversaciones",
    en: "{conversations} conversations",
  },
  conversations: { es: "Conversaciones", en: "Conversations" },
  resolvedByAi: { es: "Resoluciones verificadas", en: "Verified resolutions" },
  resolutionRate: { es: "Resoluciones verificadas", en: "Verified resolutions" },
  satisfaction: { es: "Quedaron conformes", en: "Were satisfied" },
  ratedCount: { es: "{n} calificaron", en: "{n} rated" },
  firstResponse: { es: "Primera respuesta", en: "First response" },
  escalated: { es: "Pasadas a una persona", en: "Handed to a person" },
  ordersAttributed: { es: "Pedidos del chat", en: "Orders from chat" },
  revenue: { es: "Pedidos pagados del chat", en: "Paid orders from chat" },
  amountsUnavailable: { es: '{n} importes no verificables', en: '{n} unverifiable amounts' },
  resultsEmpty: {
    es: "Todavía no hay conversaciones por este canal.",
    en: "No conversations on this channel yet.",
  },
  period: { es: "Últimos 30 días", en: "Last 30 days" },

  // ── Guardado ──
  save: { es: "Guardar", en: "Save" },
  saving: { es: "Guardando…", en: "Saving…" },
  saved: { es: "Guardado", en: "Saved" },
  saveFailed: { es: "No se pudo guardar", en: "Couldn't save" },
  addressRequestTitle: { es: 'Cambio de dirección', en: 'Address change' },
  addressRequestConfirm: { es: 'Revisé la dirección solicitada', en: 'I reviewed the requested address' },
  addressRequestScope: { es: 'El equipo revisará la solicitud antes de cambiar el pedido.', en: 'The team will review the request before changing the order.' },
  addressRequestSend: { es: 'Solicitar cambio', en: 'Request change' },
  addressRequestRefresh: { es: 'Consultar estado', en: 'Check status' },
  addressRequestAgain: { es: 'Solicitar otra corrección', en: 'Request another correction' },
  addressRequestPrepare: { es: 'Preparar cambio solicitado', en: 'Prepare requested change' },
  addressRequestTeamTitle: { es: 'Solicitud del cliente', en: 'Customer request' },
  addressRequestEmpty: { es: 'Sin solicitudes vigentes', en: 'No current requests' },
  addressRequestStatus_not_submitted: { es: 'Envío pendiente', en: 'Submission pending' },
  addressRequestStatus_waiting_review: { es: 'Solicitud recibida · pendiente de revisión', en: 'Request received · awaiting review' },
  addressRequestStatus_prepared: { es: 'Cambio preparado · pendiente de aprobación', en: 'Change prepared · awaiting approval' },
  addressRequestStatus_processing: { es: 'Cambio en proceso', en: 'Change in progress' },
  addressRequestStatus_confirmed: { es: 'Cambio confirmado el {date}', en: 'Change confirmed on {date}' },
  addressRequestStatus_needs_review: { es: 'Resultado pendiente de revisión', en: 'Result needs review' },
  addressRequestStatus_not_completed: { es: 'Cambio no completado', en: 'Change not completed' },
  addressRequestStatus_superseded: { es: 'Solicitud sustituida por una posterior', en: 'Request replaced by a later one' },
  addressRequestError_invalid: { es: 'Revisa los datos de la solicitud.', en: 'Check the request details.' },
  addressRequestError_notFound: { es: 'Solicitud no disponible.', en: 'Request unavailable.' },
  addressRequestError_changed: { es: 'La solicitud cambió. Consulta su estado.', en: 'The request changed. Check its status.' },
  addressRequestError_pending: { es: 'Hay una operación pendiente de revisión para este pedido.', en: 'An operation for this order is awaiting review.' },
  addressRequestError_limited: { es: 'Límite de solicitudes alcanzado. Intenta más tarde.', en: 'Request limit reached. Try later.' },
  addressRequestError_readOnly: { es: 'Este negocio no admite cambios en este momento.', en: 'This business cannot accept changes right now.' },
  addressRequestError_unavailable: { es: 'No se pudo comprobar el resultado. Conserva la solicitud e intenta de nuevo.', en: 'The result could not be verified. Keep the request and retry.' },
  addressRequest_address1: { es: 'Dirección', en: 'Address' },
  addressRequest_address2: { es: 'Apartamento o complemento', en: 'Apartment or additional details' },
  addressRequest_city: { es: 'Ciudad', en: 'City' },
  addressRequest_province: { es: 'Departamento o estado', en: 'State or province' },
  addressRequest_zip: { es: 'Código postal', en: 'Postal code' },
  addressRequest_countryCode: { es: 'País', en: 'Country' },
} satisfies Namespace;
