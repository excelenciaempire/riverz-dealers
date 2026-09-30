import type { Namespace } from './types';

/**
 * Copy de la portada editorial (riverz.co/portada-b).
 *
 * Este archivo sigue la investigación de mercado del 26 de agosto de 2026
 * (`investigacion-mercado-avatar-funcionalidades-riverz.md`). Cuatro cosas de
 * ahí mandan sobre todo lo demás:
 *
 * 1. **La categoría no es «chatbot» ni «sistema agéntico».** Es IA OPERATIVA
 *    para e-commerce: convierte una conversación en el siguiente paso de
 *    venta o postventa sin perder el control.
 *
 * 2. **No liderar con «responde 24/7».** Está explícito en el capítulo de qué
 *    no conviene prometer: Meta Business Agent y media docena de competidores
 *    ya dicen exactamente eso, así que como titular no diferencia nada.
 *
 * 3. **La oferta es el argumento más fuerte y no estaba en la página.**
 *    Instalación gratis, configuración guiada y aprobación antes de activar
 *    la mensualidad. Se cobra desde la activación, no tras una promesa vaga de resultados.
 *
 * 4. **El mecanismo, no la marca del mecanismo.** El documento lo bautizaba
 *    «Riverz Loop»; en la página no aparece esa palabra. Nadie que entra por
 *    primera vez sabe qué es un loop, y una portada no enseña vocabulario
 *    propio. Lo que sí queda es el argumento: un chatbot termina cuando
 *    responde; Riverz recién termina cuando la venta avanzó o quedó en manos
 *    de la persona correcta. Los cinco pasos están escritos del lado del
 *    comercio, y el cuarto —«cierra la venta, no solo la charla»— es el que
 *    carga la diferencia, por si alguien lee uno solo.
 *
 * El avatar es Camila: fundadora o líder de e-commerce, 28-45, que ya vende y
 * ya invierte en pauta, y que está perdiendo parte de esa inversión entre
 * mensajes sin responder y pendientes que solo viven en la memoria del equipo.
 * Se le habla a ella, no a alguien que busca su primera venta.
 *
 * Las trece funciones siguen leyéndose del catálogo `landing`, que ya está
 * trabajado, para no decir dos cosas distintas en dos portadas.
 *
 * Falta a propósito: testimonios, cifras de facturación y garantías de ventas.
 * El producto está en prelanzamiento y el documento es explícito en no
 * prometer aumentos que no se puedan atribuir por cuenta.
 */
export const landingV4 = {
  compareTitle: {
    es: 'La diferencia está en todo lo que resuelve.',
    en: 'The difference is in everything it handles.',
  },
  compareIntro: {
    es: 'Canales, tienda, campañas y llamadas conectados. Nosotros lo configuramos y ajustamos contigo.',
    en: 'Channels, store, campaigns, and calls connected. We set it up and refine it with you.',
  },
  compareCriterion: { es: 'Qué cambia', en: 'What changes' },
  compareOthers: { es: 'Otras plataformas', en: 'Other platforms' },
  compare1Topic: { es: 'Instalación y ajustes', en: 'Setup and changes' },
  compare1Riverz: { es: 'Los hacemos contigo', en: 'We handle them with you' },
  compare1Others: {
    es: 'Autoservicio o asesoría',
    en: 'Self-service or onboarding',
  },
  compare2Topic: { es: 'Ventas y soporte con IA', en: 'AI sales and support' },
  compare2Riverz: {
    es: 'Agentes con tu catálogo y reglas',
    en: 'Agents with your catalog and rules',
  },
  compare2Others: {
    es: 'Según producto y plan',
    en: 'Varies by product and plan',
  },
  compare3Topic: { es: 'Pedidos y postventa', en: 'Orders and after-sales' },
  compare3Riverz: {
    es: 'Consulta y edita pedidos',
    en: 'Looks up and edits orders',
  },
  compare3Others: {
    es: 'Según integración',
    en: 'Depends on integrations',
  },
  compare4Topic: { es: 'Carritos y recompras', en: 'Carts and repeat sales' },
  compare4Riverz: {
    es: 'Seguimientos listos para activar',
    en: 'Follow-ups ready to launch',
  },
  compare4Others: {
    es: 'Flujos por configurar',
    en: 'Flows to configure',
  },
  compare5Topic: { es: 'Canales y comentarios', en: 'Channels and comments' },
  compare5Riverz: {
    es: 'Mensajes y comentarios juntos',
    en: 'Messages and comments together',
  },
  compare5Others: {
    es: 'Cobertura según plataforma',
    en: 'Coverage varies by platform',
  },
  compare6Topic: { es: 'Campañas', en: 'Campaigns' },
  compare6Riverz: {
    es: 'Segmentos y envíos configurados',
    en: 'Segments and sends set up',
  },
  compare6Others: { es: 'Disponibles según plan', en: 'Available by plan' },
  compare7Topic: { es: 'Llamadas con IA', en: 'AI calls' },
  compare7Riverz: {
    es: 'Agente con el contexto del chat',
    en: 'Agent with chat context',
  },
  compare7Others: {
    es: 'Voz según canal y plan',
    en: 'Voice varies by channel and plan',
  },
  compare8Topic: { es: 'Control de acciones', en: 'Action controls' },
  compare8Riverz: {
    es: 'Aprobaciones con contexto',
    en: 'Context-aware approvals',
  },
  compare8Others: {
    es: 'Controles según herramienta',
    en: 'Controls vary by tool',
  },
  compare9Topic: { es: 'Resultados', en: 'Results' },
  compare9Riverz: {
    es: 'Ventas atribuidas a conversaciones',
    en: 'Sales attributed to conversations',
  },
  compare9Others: {
    es: 'Analítica según plataforma',
    en: 'Analytics vary by platform',
  },
  leadSubmit: { es: 'Hablemos', en: 'Let’s talk' },
  leadDone: {
    es: 'Gracias. Recibimos tu solicitud.',
    en: 'Thanks. We received your request.',
  },
  demoLabel: { es: 'Ejemplo de funcionamiento', en: 'How it works · example' },
  featureSalesTitle: { es: 'Responde dudas.', en: 'Answer questions.' },
  featureSalesMuted: { es: 'Ayuda a comprar.', en: 'Help customers buy.' },
  featureSalesBody: {
    es: 'Consulta productos, precios y disponibilidad. Recomienda opciones y envía el enlace de compra cuando el cliente está listo.',
    en: 'Check products, prices, and availability. Recommend options and send a checkout link when the customer is ready.',
  },
  featureRecoveryTitle: { es: 'Dale seguimiento', en: 'Follow up' },
  featureRecoveryMuted: {
    es: 'a la compra pendiente.',
    en: 'on unfinished purchases.',
  },
  featureRecoveryBody: {
    es: 'Retoma carritos abandonados y pagos pendientes con mensajes sobre los productos que el cliente dejó en la tienda.',
    en: 'Follow up on abandoned carts and pending payments with messages about the products the customer left behind.',
  },
  featureSupportTitle: {
    es: '«¿Dónde está mi pedido?»',
    en: '“Where’s my order?”',
  },
  featureSupportMuted: {
    es: 'Una interrupción menos.',
    en: 'One less interruption.',
  },
  featureSupportBody: {
    es: 'Consulta el pedido, comparte el seguimiento disponible y atiende dudas de entrega. Las excepciones pasan a tu equipo.',
    en: 'Look up orders, share available tracking, and handle delivery questions. Exceptions go to your team.',
  },
  featureVoiceTitle: { es: 'También puede llamar.', en: 'It can call, too.' },
  featureVoiceMuted: {
    es: 'Con una voz natural.',
    en: 'With a natural voice.',
  },
  featureVoiceBody: {
    es: 'Confirma pedidos o da seguimiento por teléfono. También puede atender llamadas entrantes. Puedes revisar la transcripción y el resultado.',
    en: 'Confirm orders or follow up by phone. It can also handle incoming calls. Review the transcript and outcome.',
  },
  featureCommentsTitle: { es: 'Tus comentarios', en: 'Your comments' },
  featureCommentsMuted: { es: 'también cuentan.', en: 'matter too.' },
  featureCommentsBody: {
    es: 'Atiende preguntas en publicaciones y anuncios de los canales conectados. Continúa por mensaje privado cuando el canal lo permite.',
    en: 'Answer questions on posts and ads across connected channels. Continue in private messages when the channel allows it.',
  },
  featureRetentionTitle: { es: 'Vuelve a conversar', en: 'Reconnect' },
  featureRetentionMuted: {
    es: 'con quienes ya te compraron.',
    en: 'with past customers.',
  },
  featureRetentionBody: {
    es: 'Organiza seguimientos de postventa, recordatorios de recompra y campañas para segmentos de tu base de clientes.',
    en: 'Set up post-purchase follow-ups, reorder reminders, and campaigns for segments of your customer base.',
  },
  featureCampaignsTitle: { es: 'Una campaña.', en: 'One campaign.' },
  featureCampaignsMuted: {
    es: 'Las personas correctas.',
    en: 'The right people.',
  },
  featureCampaignsBody: {
    es: 'Elige a quién escribir según sus compras o intereses. Envía novedades y ofertas a contactos con permiso, respetando las reglas de cada canal.',
    en: 'Choose who to reach based on purchases or interests. Send news and offers to opted-in contacts, following each channel’s rules.',
  },
  featureLiveTitle: {
    es: 'Mira la conversación.',
    en: 'See the conversation.',
  },
  featureLiveMuted: {
    es: 'Intervén cuando haga falta.',
    en: 'Step in when needed.',
  },
  featureLiveBody: {
    es: 'Revisa lo que responde la IA y toma el control del chat. Tu equipo puede continuar con el historial a la vista.',
    en: 'Review AI replies and take over the chat. Your team can continue with the conversation history in view.',
  },
  featureStoreTitle: { es: 'El pedido se resuelve', en: 'Handle the order' },
  featureStoreMuted: {
    es: 'desde la conversación.',
    en: 'from the conversation.',
  },
  featureStoreBody: {
    es: 'Consulta pedidos, corrige una dirección o gestiona una cancelación según la integración. Tú decides qué cambios necesitan aprobación.',
    en: 'Look up orders, correct an address, or handle a cancellation where the integration supports it. You decide which changes need approval.',
  },
  featureInboxTitle: { es: 'Deja de saltar', en: 'Stop switching' },
  featureInboxMuted: { es: 'entre bandejas.', en: 'between inboxes.' },
  featureInboxBody: {
    es: 'Reúne los mensajes de tus canales conectados en una sola bandeja. Asigna conversaciones y encuentra los casos pendientes.',
    en: 'Bring messages from connected channels into one inbox. Assign conversations and find cases that still need attention.',
  },
  featureSetupTitle: {
    es: 'Tu forma de trabajar.',
    en: 'Your way of working.',
  },
  featureSetupMuted: {
    es: 'Configurada por nosotros.',
    en: 'Configured by us.',
  },
  featureSetupBody: {
    es: 'Nos explicas cómo vendes y atiendes. Nosotros preparamos respuestas, conexiones y seguimientos; tú los pruebas antes de activarlos.',
    en: 'Tell us how you sell and support customers. We prepare replies, connections, and follow-ups; you test them before they go live.',
  },
  featureContactsTitle: { es: 'Cada cliente', en: 'Every customer' },
  featureContactsMuted: { es: 'con su historia.', en: 'with their history.' },
  featureContactsBody: {
    es: 'Consulta conversaciones, datos y etiquetas en la ficha del contacto. Organiza tu base sin depender de notas sueltas.',
    en: 'See conversations, details, and tags in each contact’s profile. Organize your customer base without scattered notes.',
  },
  featureResultsTitle: {
    es: 'Revisa qué se resolvió.',
    en: 'See what got resolved.',
  },
  featureResultsMuted: {
    es: 'Y qué necesita atención.',
    en: 'And what needs attention.',
  },
  featureResultsBody: {
    es: 'Consulta conversaciones atendidas, tareas pendientes y resultados de los flujos conectados. Así sabes dónde ajustar, sin revisar cada chat.',
    en: 'Review handled conversations, pending tasks, and results from connected workflows. Know where to make adjustments without opening every chat.',
  },
  // ── Metadatos ──
  metaTitle: { es: 'riverz', en: 'riverz' },
  metaDescription: {
    es: 'IA operativa para e-commerce. Riverz convierte mensajes, carritos y pagos pendientes en el siguiente paso de venta o postventa, con las reglas de tu negocio.',
    en: 'Operational AI for ecommerce. Riverz turns messages, abandoned carts, and pending payments into the next sales or post-purchase step, under your business rules.',
  },

  // ── Barra de aviso: la oferta, que es lo más fuerte que tenemos ──
  bannerLead: { es: 'Instalación gratis', en: 'Free setup' },
  bannerDiscount: {
    es: '{percent} % menos el primer mes',
    en: '{percent}% off month one',
  },
  bannerText: {
    es: 'la configuramos contigo; apruebas el sistema y activas tu plan.',
    en: 'we set it up with you; you approve the system and activate your plan.',
  },
  bannerVer: { es: 'Ver cómo', en: 'See how' },
  cerrar: { es: 'Cerrar', en: 'Close' },

  // ── Navegación ──
  // El enlace dice lo mismo que la etiqueta de la sección a la que lleva: si
  // no coinciden, quien hace clic cree que aterrizó en otro lado.
  navChannels: { es: 'Canales', en: 'Channels' },
  navCta: { es: 'Hablemos de tu tienda', en: 'Let’s talk about your store' },
  skipToContent: { es: 'Ir al contenido', en: 'Skip to content' },

  // ── Hero ──
  // El titular parte del punto de partida real del cliente: la tienda ya
  // vende. La bajada nombra el trabajo que se pierde entre intención y pedido,
  // sin pedirle que aprenda una categoría nueva.
  heroTitleLead: {
    es: 'Vende y atiende con un equipo de IA.',
    en: 'An AI team for your store’s sales and support.',
  },
  heroAgentRoles: {
    es: 'Ventas · Soporte · Seguimiento',
    en: 'Sales · Support · Follow-up',
  },
  mascotIllustration: {
    es: 'Escena ilustrativa con IA',
    en: 'AI-generated illustration',
  },
  heroTitleMuted: {
    es: 'Nosotros lo dejamos listo.',
    en: 'Set up for you.',
  },
  heroSubtitle: {
    es: 'Responde consultas, retoma carritos y da seguimiento a pedidos sin montar los flujos tú mismo. Lo configuramos con tu catálogo, tu tono y tus reglas.',
    en: 'Answer questions, follow up on abandoned carts, and track orders without building workflows yourself. We configure it with your catalog, your voice, and your rules.',
  },

  // ── Muro de plataformas ──
  wallLabel: { es: 'Se conecta con', en: 'Connects to' },

  // ── Riverz Launch: la oferta, en pasos ──
  launchLabel: { es: 'Riverz Launch', en: 'Riverz Launch' },
  launchTitle: {
    es: 'No tienes que configurar nada',
    en: "You don't have to set anything up",
  },
  launchBody: {
    es: 'Otras herramientas te dan un panel vacío. Riverz llega montado: conectas la tienda y nosotros hacemos el resto.',
    en: 'Other tools hand you an empty dashboard. Riverz arrives built: you connect the store, we do the rest.',
  },
  // Su propio botón, distinto al de la barra. El de arriba dice qué hacés;
  // éste dice qué te llevás, que es de lo que trata el diálogo.
  launchCta: { es: 'Que lo monten por mí', en: 'Set it up for me' },
  launch1Title: { es: 'Conectas tu tienda', en: 'You connect your store' },
  launch1Body: {
    es: 'Unos clics. No hay nada que diseñar.',
    en: 'A few clicks. Nothing to design.',
  },
  launch2Title: {
    es: 'Riverz estudia tu marca',
    en: 'Riverz studies your brand',
  },
  launch2Body: {
    es: 'Catálogo, políticas, tono y pedidos.',
    en: 'Catalog, policies, tone and orders.',
  },
  launch3Title: { es: 'Lo configuramos nosotros', en: 'We configure it' },
  launch3Body: {
    es: 'Agentes, flujos, seguimientos y límites.',
    en: 'Agents, flows, follow-ups and limits.',
  },
  launch4Title: { es: 'Tú apruebas', en: 'You approve' },
  launch4Body: {
    es: 'No le escribe a nadie hasta que digas que sí.',
    en: 'It writes to nobody until you say yes.',
  },
  launch5Title: { es: 'Activas tu plan', en: 'Activate your plan' },
  launch5Body: {
    es: 'Revisamos juntos la configuración. Al aprobarla, empieza tu mensualidad y seguimos ajustando contigo.',
    en: 'We review the setup together. Once you approve it, your monthly plan starts and we keep refining it with you.',
  },

  // ── Riverz Loop: el mecanismo ──
  // «Riverz Loop» era un nombre interno. Nadie que entra por primera vez sabe
  // qué es un loop, y una portada no es el lugar para enseñar vocabulario
  // propio: la etiqueta dice qué vas a leer y el titular hace el argumento.
  // El titular decía «Un chatbot termina cuando responde»: una adivinanza que
  // obligaba a leer la bajada para entenderla, y la bajada tampoco cerraba
  // («la venta avanzó» no es nada que se pueda ver). Ahora el titular es la
  // comparación directa y la bajada la prueba con lo único que se nota: quién
  // carga el pedido.
  loopTitle: {
    es: 'Del primer mensaje al siguiente paso.',
    en: 'From the first message to the next step.',
  },
  loopLead: {
    es: 'Así atiende tu equipo de IA: consulta la información, aplica tus reglas y da seguimiento. Tú puedes ver lo que hace e intervenir.',
    en: 'Your AI team checks the facts, follows your rules, and takes the next step. You can review its work and step in.',
  },
  // Cinco pasos, del lado del comercio. Sin «señal», sin «contexto», sin
  // «ejecuta»: nadie que vende por WhatsApp piensa con esas palabras.
  loop1Title: {
    es: 'Atiende sin que estés pendiente.',
    en: 'Keep conversations moving while you’re busy.',
  },
  loop1Body: {
    es: 'Una pregunta por WhatsApp o un comentario en un anuncio inicia la conversación. La IA responde y continúa el seguimiento que acordamos contigo.',
    en: 'A WhatsApp question or an ad comment starts the conversation. AI replies and follows the process we agreed on with you.',
  },
  loop1P1: {
    es: 'Canales, comentarios y chat web',
    en: 'Channels, comments, and web chat',
  },
  loop1P2: {
    es: 'Eventos de tienda y pagos conectados',
    en: 'Connected store and payment events',
  },

  loop2Title: {
    es: 'Consulta antes de responder.',
    en: 'Checks before replying.',
  },
  loop2Body: {
    es: 'Busca el producto, revisa la disponibilidad y consulta el pedido o el historial del cliente. Responde con la información de tus sistemas conectados.',
    en: 'It looks up products, checks availability, and reviews the customer’s order or history. Replies use information from your connected systems.',
  },
  loop2P1: {
    es: 'Productos, precios y stock de tu tienda',
    en: 'Your store’s products, prices, and stock',
  },
  loop2P2: {
    es: 'Historial de compras y conversaciones',
    en: 'Purchase and conversation history',
  },

  loop3Title: {
    es: 'Tú marcas los límites.',
    en: 'You set the limits.',
  },
  loop3Body: {
    es: 'Consultar un envío puede ser automático. Cambiar una dirección puede requerir aprobación. Los reembolsos pueden quedar en manos de tu equipo. Tú eliges.',
    en: 'Tracking an order can be automatic. An address change can require approval. Refunds can stay with your team. You choose.',
  },
  loop3P1: {
    es: 'Cada acción: apagada, con aprobación o automática',
    en: 'Each action: off, approval required, or automatic',
  },
  loop3P2: {
    es: 'Tu equipo toma los casos sensibles',
    en: 'Your team handles sensitive cases',
  },

  // El cuarto es el argumento entero. Si alguien lee un solo paso, que sea este.
  loop4Title: {
    es: 'Del interés al pedido.',
    en: 'From interest to an order.',
  },
  loop4Body: {
    es: 'Recomienda el producto, envía el enlace de compra y gestiona el pedido según la integración. El seguimiento continúa después de la venta.',
    en: 'Recommend the product, send a checkout link, and handle the order where your integration supports it. Follow-up continues after the sale.',
  },
  loop4P1: {
    es: 'Del chat al pedido, sin cambiar de herramienta',
    en: 'From chat to order, without switching tools',
  },
  loop4P2: {
    es: 'Acciones disponibles según cada conexión',
    en: 'Actions available for each connection',
  },

  loop5Title: {
    es: 'Revisa lo resuelto y lo pendiente.',
    en: 'See what’s handled and what needs you.',
  },
  loop5Body: {
    es: 'Consulta conversaciones atendidas, pedidos y casos que necesitan a tu equipo. Cuando hay datos de venta conectados, revisa también los resultados atribuidos.',
    en: 'Review handled conversations, orders, and cases that need your team. When sales data is connected, you can also review attributed results.',
  },
  loop5P1: {
    es: 'Resultados y conversaciones en un solo lugar',
    en: 'Results and conversations in one place',
  },
  loop5P2: {
    es: 'Historial para revisar y ajustar respuestas',
    en: 'Conversation history to review and refine replies',
  },

  // ── Los pilares: el ángulo del chat ya pagado ──
  // Esta sección es el PROBLEMA, y es lo único que dice que no diga otra.
  // Tenía además tres pilares —Recupera, Ejecuta, Delega— que repetían, uno por
  // uno, el titular de acá mismo, el de «La diferencia» y una viñeta del paso
  // 03. Se fueron los tres: en un teléfono eran media pantalla de texto ya
  // leído.
  pillarsTitle: {
    es: 'Que vender más no signifique vivir pendiente del chat.',
    en: 'More sales shouldn’t mean living in your inbox.',
  },
  pillarsLead: {
    es: 'Configuramos tu equipo de IA. Tú apruebas las reglas y puedes pedir cambios cuando lo necesites.',
    en: 'We set up your AI team. You approve the rules and request changes whenever you need them.',
  },

  // ── Qué hace (la cuadrícula de fichas) ──
  capsTitle: {
    es: 'El trabajo que hoy te llena el día.',
    en: 'The work that fills your day.',
  },
  capsBody: {
    es: 'Desde la primera pregunta hasta después de la entrega. Elige qué delegar y qué necesita a tu equipo.',
    en: 'From the first question to after delivery. Choose what to delegate and what needs your team.',
  },
  capsZeroLabel: { es: 'líneas de código', en: 'lines of code' },

  // Lo poco que las composiciones no pueden tomar del catálogo `landing`.
  compMes1: { es: 'Marzo', en: 'March' },
  compMes2: { es: 'Junio', en: 'June' },
  compHoy: { es: 'Hoy', en: 'Today' },
  compSincro: {
    es: 'Stock · Precios · Pedidos',
    en: 'Stock · Prices · Orders',
  },

  // Vendedor: la gracia es que la respuesta CITA el dato de la ficha.
  compAsk: { es: '¿Les queda en talla 38?', en: 'Do you have it in size 38?' },
  compAnswer: {
    es: 'Sí, quedan 4 en talla 38. Te la aparto.',
    en: "Yes, 4 left in size 38. I'll hold one for you.",
  },
  compStock: { es: 'Talla 38 · 4 en stock', en: 'Size 38 · 4 in stock' },
  compCatalog: { es: 'Tu catálogo', en: 'Your catalog' },

  // Atención: la hora es el argumento entero.
  compOrder: { es: 'Pedido', en: 'Order' },
  compConfirmed: { es: 'Confirmado', en: 'Confirmed' },
  compShipped: { es: 'En camino', en: 'On its way' },
  compTracking: { es: 'Guía 889-2231', en: 'Tracking 889-2231' },
  compHour: { es: '3:14 a. m.', en: '3:14 AM' },

  // Comentarios: el comentario público y el DM que sigue.
  compComment: { es: 'precio?', en: 'how much?' },
  compPublicReply: {
    es: '¡Te escribimos por DM! 💛',
    en: 'Just sent you a DM! 💛',
  },
  compDm: {
    es: '$239.000 y tenemos envío gratis hoy.',
    en: '$239,000 and shipping is free today.',
  },

  // Bandeja: los cinco canales y la fila que llega.
  compOneInbox: { es: 'Una bandeja', en: 'One inbox' },
  compUnread: { es: '3 sin responder', en: '3 unanswered' },

  // En vivo: lo que se ve desde el teléfono.
  compLiveNow: { es: 'En vivo', en: 'Live' },
  compTakeOver: { es: 'Entrar a la conversación', en: 'Join the conversation' },

  // Contactos: la ficha que se llena sola y el segmento que sale de ella.
  compCity: { es: 'Bogotá', en: 'Bogotá' },
  compSpent: { es: '$1.240.000 gastados', en: '$1,240,000 spent' },
  compOrders: { es: '3 pedidos', en: '3 orders' },
  compSegment: {
    es: 'Compradores frecuentes · 412',
    en: 'Frequent buyers · 412',
  },

  // Puesta en marcha: tres pasos y ya.
  compStep1: { es: 'Conecta la tienda', en: 'Connect your store' },
  compStep2: { es: 'Conecta WhatsApp', en: 'Connect WhatsApp' },
  compStep3: { es: 'Enciende el agente', en: 'Turn the agent on' },
  compMinutes: { es: '8 minutos', en: '8 minutes' },

  // ROAS: la cifra y de dónde sale.
  compRoas: { es: 'ROAS', en: 'ROAS' },
  compAttributed: { es: 'Atribuido al agente', en: 'Attributed to the agent' },
  compInvested: { es: 'Invertido', en: 'Spent' },
  compReturned: { es: 'Devuelto', en: 'Returned' },

  // Demostración compacta dentro del bloque editorial.
  operatorTitle: {
    es: 'Nosotros lo montamos. Tú puedes dirigirlo.',
    en: 'We set it up. You can steer it.',
  },
  operatorLead: {
    es: 'El equipo sigue las reglas que configuramos. Si necesitas algo nuevo, pídelo en una frase y aprueba el plan.',
    en: 'The team follows the rules we configure. When you need something new, ask in one sentence and approve the plan.',
  },

  // Lo que se escribe y lo que contesta, dentro de la animación.
  opPrompt: {
    es: 'Recupera los carritos de esta semana',
    en: "Recover this week's abandoned carts",
  },
  opLine1: {
    es: 'Carritos seleccionados',
    en: 'Carts selected',
  },
  opLine2: {
    es: 'Mensaje personalizado',
    en: 'Message personalized',
  },
  opLine3: {
    es: 'Seguimiento preparado',
    en: 'Follow-up prepared',
  },
  opAsk: { es: '¿Lo activo?', en: 'Shall I turn it on?' },
  opApprove: { es: 'Aprobar', en: 'Approve' },
  opNote: {
    es: 'Revisas esta campaña antes de activarla.',
    en: 'Review this campaign before it goes live.',
  },

  // ── Canales ──
  channelsTitle: {
    es: 'Tus canales. Tu tienda. Todo conectado.',
    en: 'Your channels. Your store. All connected.',
  },
  channelsBody: {
    es: 'Mensajes y comentarios en un mismo lugar, con los datos de tu tienda a mano. Revisamos contigo las conexiones que necesita tu operación.',
    en: 'Messages and comments in one place, with your store’s data at hand. We review the connections your business needs together.',
  },
  channelsInboxes: { es: 'Bandejas', en: 'Inboxes' },
  channelsStores: { es: 'Tiendas y logística', en: 'Stores and logistics' },
  channelsCalls: { es: 'Llamadas', en: 'Calls' },

  // ── Precios ──
  pricingTitle: { es: 'Planes', en: 'Plans' },
  pricingVolumeLabel: {
    es: 'Contactos al mes',
    en: 'Monthly contacts',
  },
  pricingUpToCustomers: {
    es: 'Hasta {count} contactos al mes',
    en: 'Up to {count} contacts per month',
  },
  pricingCustomVolume: {
    es: 'Más de 10.000 contactos al mes',
    en: 'More than 10,000 contacts per month',
  },
  pricingTierMore: { es: '10k+', en: '10k+' },
  pricingPerMonth: { es: 'al mes', en: 'per month' },
  pricingFreeSetup: { es: 'Instalación gratis', en: 'Free setup' },
  pricingOfferBadge: {
    es: '{percent} % menos el primer mes',
    en: '{percent}% off the first month',
  },
  pricingFirstMonth: { es: 'Primer mes', en: 'First month' },
  pricingDiscountShort: { es: '{percent}% OFF', en: '{percent}% OFF' },
  pricingFromSecondMonth: { es: 'Desde el segundo mes', en: 'From month two' },
  pricingUpgradeTerms: {
    es: 'El descuento aplica al plan inicial. Si amplías el cupo, apruebas el cargo adicional antes de pagarlo.',
    en: 'The discount applies to your initial plan. If you increase capacity, you approve the additional charge before paying.',
  },
  pricingSetupTerms: {
    es: 'Lo configuramos contigo. Apruebas antes de pagar.',
    en: 'We set it up with you. Approve it before paying.',
  },
  pricingCustomSetupTerms: {
    es: 'Definimos el precio según tu volumen antes de activar el plan.',
    en: 'We agree on pricing for your volume before activating the plan.',
  },
  pricingCta: { es: 'Solicitar instalación gratis', en: 'Request free setup' },
  pricingCalculatorOffer: {
    es: 'Instalación gratis y {percent} % de descuento el primer mes: {amount}.',
    en: 'Free setup and {percent}% off the first month: {amount}.',
  },
  pricingCustomPrice: { es: 'Hablemos', en: "Let's talk" },
  pricingPerContactMath: {
    es: '{total} ÷ {contacts} ≈ {amount} USD por contacto',
    en: '{total} ÷ {contacts} ≈ {amount} USD per contact',
  },
  pricingPerContact: {
    es: '{amount} centavos de USD por contacto al mes',
    en: '{amount} US cents per contact per month',
  },
  pricingEverythingIncluded: {
    es: 'Incluido en todos los planes:',
    en: 'Included in every plan:',
  },
  pricingIncludedAgents: {
    es: 'Todos los agentes y consumo de IA',
    en: 'All agents and AI usage',
  },
  pricingIncludedSales: {
    es: 'Ventas, recuperación, soporte y postventa',
    en: 'Sales, recovery, support, and post-purchase',
  },
  pricingIncludedChannels: {
    es: 'Canales, comentarios, chat web y voz',
    en: 'Channels, comments, web chat, and voice',
  },
  pricingIncludedOperator: {
    es: 'Automatizaciones, ajustes y aprobaciones',
    en: 'Automations, adjustments, and approvals',
  },
  pricingIncludedIntegrations: {
    es: 'Integraciones con tienda, pagos y logística',
    en: 'Store, payment, and logistics integrations',
  },
  pricingIncludedResults: {
    es: 'Resultados y ventas atribuidas',
    en: 'Results and attributed sales',
  },
  // Plan con saldo: aparece al tocar el título «Planes».
  pricingBalanceContacts: {
    es: 'Contactos {unlimited}',
    en: '{unlimited} contacts',
  },
  pricingBalanceUnlimited: { es: 'ilimitados', en: 'Unlimited' },
  pricingBalancePlus: { es: '+ tu saldo', en: '+ your balance' },
  pricingBalanceTerms: {
    es: 'El consumo de IA se descuenta del saldo que recargas.',
    en: 'AI usage is deducted from the balance you top up.',
  },
  pricingBalanceIncluded: {
    es: 'Incluido en el plan:',
    en: 'Included in the plan:',
  },
  pricingBalanceAgents: { es: 'Todos los agentes', en: 'All agents' },
  roiTitle: {
    es: 'Calcula el retorno posible',
    en: 'Estimate your potential return',
  },
  roiMetaTitle: {
    es: 'Calculadora de ROI de Riverz',
    en: 'Riverz ROI calculator',
  },
  roiMetaDescription: {
    es: 'Estima el retorno posible de Riverz con tus pedidos, ticket promedio y margen bruto.',
    en: 'Estimate Riverz’s potential return using your orders, average order value, and gross margin.',
  },
  roiPlanLabel: {
    es: 'Elige el volumen de contactos',
    en: 'Choose contact volume',
  },
  roiBackToPricing: { es: 'Volver a precios', en: 'Back to pricing' },
  roiOrdersLabel: {
    es: 'Pedidos actuales al mes',
    en: 'Current monthly orders',
  },
  roiTicketLabel: {
    es: 'Ticket promedio (US$)',
    en: 'Average order value (US$)',
  },
  roiMarginLabel: { es: 'Margen bruto (%)', en: 'Gross margin (%)' },
  roiUpliftLabel: {
    es: 'Aumento hipotético de pedidos (%)',
    en: 'Hypothetical order increase (%)',
  },
  roiCustomPriceLabel: {
    es: 'Precio mensual acordado (US$)',
    en: 'Agreed monthly price (US$)',
  },
  roiEstimatedReturn: { es: 'ROI posible al mes', en: 'Potential monthly ROI' },
  roiExtraOrders: { es: 'Pedidos adicionales', en: 'Additional orders' },
  roiAdditionalMargin: {
    es: 'Margen adicional',
    en: 'Additional gross profit',
  },
  roiInvestment: { es: 'Precio del plan', en: 'Plan price' },
  roiBreakEven: {
    es: '{count} pedidos adicionales al mes cubren el plan.',
    en: '{count} additional orders per month cover the plan.',
  },
  roiNote: {
    es: 'El aumento de pedidos es una hipótesis ajustable. El cálculo no incluye cargos externos ni ahorro de tiempo y no garantiza resultados.',
    en: 'The order increase is an adjustable assumption. This estimate excludes external charges and time savings, and does not guarantee results.',
  },
  faqTitle: { es: 'Preguntas frecuentes', en: 'Frequently asked questions' },
  faqAdditionalCostQuestion: {
    es: '¿Cuánto pagaré además de la mensualidad?',
    en: 'How much will I pay beyond the subscription?',
  },
  faqAdditionalCostAnswer: {
    es: 'El consumo de IA está incluido en tu plan por contactos. Si usas WhatsApp, los mensajes sujetos a cobro por Meta se pagan aparte, según el país y el tipo de mensaje. La meta es que ese costo sea pequeño frente a las ventas que ayuda a generar: cuando más conversaciones se convierten en pedidos, el gasto puede crecer junto con una facturación mayor. En la llamada estimamos tu presupuesto y lo ponemos en contexto con tus ventas.',
    en: 'AI usage is included in your contact-based plan. If you use WhatsApp, billable Meta messages are paid separately, based on the country and message type. The goal is for that cost to be small compared with the sales it helps generate: as more conversations become orders, spending can grow alongside higher revenue. During our call, we estimate your budget and put it in context with your sales.',
  },
  faqBalanceAdditionalCostAnswer: {
    es: 'Además de la mensualidad, pagas el consumo de IA con tu saldo y, si usas WhatsApp, los mensajes sujetos a cobro por Meta van aparte. La meta es que ambos costos sean pequeños frente a las ventas que ayudan a generar: cuando más conversaciones se convierten en pedidos, el consumo puede crecer junto con una facturación mayor. En la llamada estimamos cuánto necesitaría tu tienda y lo ponemos en contexto con tus ventas y tu margen.',
    en: 'Beyond the subscription, you pay for AI usage from your balance and, if you use WhatsApp, billable Meta messages are charged separately. The goal is for both costs to be small compared with the sales they help generate: as more conversations become orders, usage can grow alongside higher revenue. During our call, we estimate what your store would need and put it in context with your sales and profit margin.',
  },
  faqMetaRatesLink: {
    es: 'Consultar tarifas de Meta',
    en: 'View Meta pricing',
  },
  faqBalanceIncludedAnswer: {
    es: 'La mensualidad incluye los agentes, ventas, recuperación, atención, automatizaciones e integraciones disponibles, con contactos ilimitados. El consumo de IA se paga aparte con el saldo que recargas.',
    en: 'The subscription includes agents, sales, recovery, support, automations, and available integrations, with unlimited contacts. AI usage is paid separately from the balance you top up.',
  },
  faqBalanceFirstMonthAnswer: {
    es: 'La instalación y configuración son gratis. Al aprobarlas, pagas el primer mes con {percent} % de descuento; desde el segundo, la mensualidad normal que aparece arriba. Además, recargas saldo para el consumo de IA. El descuento no aplica a las recargas. No hay permanencia.',
    en: 'Setup and configuration are free. Once approved, your first month is {percent}% off; from month two, you pay the regular subscription shown above. You also top up a balance for AI usage. The discount does not apply to top-ups. There is no lock-in.',
  },
  faqBalanceCountingQuestion: {
    es: '¿Cómo funcionan los contactos ilimitados y el saldo?',
    en: 'How do unlimited contacts and the balance work?',
  },
  faqBalanceCountingAnswer: {
    es: 'Este plan no tiene un cupo mensual de contactos. La mensualidad da acceso a la plataforma y el consumo de IA se descuenta del saldo que recargas: contactos ilimitados no significa consumo de IA ilimitado.',
    en: 'This plan has no monthly contact allowance. The subscription gives you platform access, and AI usage is deducted from your prepaid balance: unlimited contacts does not mean unlimited AI usage.',
  },
  faqBalanceGrowthAnswer: {
    es: 'No necesitas subir de rango por atender más contactos. La mensualidad se mantiene; si aumenta el uso de IA, necesitarás más saldo para cubrir ese consumo.',
    en: 'You do not need to move to a higher tier to serve more contacts. The subscription stays the same; if AI usage increases, you will need more balance to cover it.',
  },
  // Cada respuesta afirma sólo lo que el producto hace hoy. La seguridad viene
  // de decirlo sin rodeos, no de prometer lo que no se puede mostrar.
  faqIncludedQuestion: {
    es: '¿Qué incluye el plan?',
    en: 'What does the plan include?',
  },
  faqIncludedAnswer: {
    es: 'Incluye los agentes, el consumo de IA, ventas, recuperación, atención, automatizaciones e integraciones disponibles. El precio depende de los contactos atendidos.',
    en: 'Includes agents, AI usage, sales, recovery, support, automations, and available integrations. Pricing depends on contacts served.',
  },
  faqWhyQuestion: {
    es: '¿Por qué Riverz y no un chatbot o un CRM de WhatsApp?',
    en: 'Why Riverz instead of a chatbot or a WhatsApp CRM?',
  },
  faqWhyAnswer: {
    es: 'Porque casi todo lo demás termina en “respuesta enviada” y deja la venta para que la cierre una persona. Riverz atiende la conversación completa hasta el resultado: cotiza con el precio real de tu catálogo, arma el pedido, manda el link de pago, registra el comprobante, recupera el carrito abandonado y avisa cuando el envío sale. Un CRM te ordena el trabajo; Riverz lo hace.',
    en: 'Because almost everything else stops at “reply sent” and leaves the sale for a person to close. Riverz takes the whole conversation to the outcome: it quotes the real price from your catalog, builds the order, sends the payment link, records the receipt, recovers the abandoned cart, and lets the customer know when the shipment leaves. A CRM organizes the work; Riverz does it.',
  },
  faqSellsQuestion: {
    es: '¿Vende de verdad o solo contesta?',
    en: 'Does it actually sell, or just reply?',
  },
  faqSellsAnswer: {
    es: 'Vende. El agente tiene manos, no solo voz: consulta el pedido en tu tienda, crea el checkout con la oferta correcta, genera links de pago, registra transferencias, aplica solo los descuentos que tú autorizaste y, si hace falta, llama por teléfono. Cada venta queda atribuida a la conversación que la cerró, así que ves exactamente qué produjo.',
    en: 'It sells. The agent has hands, not just a voice: it looks up the order in your store, creates the checkout with the right offer, generates payment links, records bank transfers, applies only the discounts you authorized and, when needed, places a phone call. Every sale is attributed to the conversation that closed it, so you see exactly what it produced.',
  },
  faqSetupQuestion: {
    es: '¿Cuánto tarda en estar funcionando?',
    en: 'How long until it is running?',
  },
  faqSetupAnswer: {
    es: 'Revisamos tu tienda y lo que quieres delegar. Configuramos los agentes y probamos contigo antes de activarlos. Confirmamos el plazo según las conexiones y ajustes necesarios antes de empezar.',
    en: 'We review your store and the work you want to delegate. We configure and test agents with you before activation. We confirm timing based on the connections and adjustments needed before starting.',
  },
  faqFirstMonthQuestion: {
    es: '¿Qué pago al comenzar?',
    en: 'What do I pay to get started?',
  },
  faqFirstMonthAnswer: {
    es: 'La instalación y configuración son gratis. Cuando apruebas lo que montamos, pagas el primer mes con {percent} % de descuento. Desde el segundo mes pagas el precio normal de tu plan. No hay permanencia.',
    en: 'Setup and configuration are free. Once you approve what we built, you pay the first month at {percent}% off. From month two, you pay your plan’s regular price. There is no lock-in.',
  },
  faqCountingQuestion: {
    es: '¿Qué significa “contactos atendidos al mes”?',
    en: 'What does “contacts served per month” mean?',
  },
  faqCountingAnswer: {
    es: 'Contamos cada contacto al que la IA envía al menos una respuesta durante tu período de facturación. Si usa varios canales y podemos verificar que es la misma persona, cuenta una sola vez. No cobramos cada mensaje ni cada conversación.',
    en: 'We count each contact who receives at least one AI reply during your billing period. If they use multiple channels and we can verify they are the same person, they count once. We do not charge per message or conversation.',
  },
  faqGrowthQuestion: {
    es: '¿Qué pasa si mi tienda crece?',
    en: 'What happens if my store grows?',
  },
  faqGrowthAnswer: {
    es: 'Los rangos son 500, 2.000, 5.000 y 10.000 contactos por período. Te avisamos al 80 % y al llegar al límite. Si amplías el plan, ves y apruebas el cargo proporcional por el tiempo restante; el nuevo precio mensual empieza en la siguiente renovación. No hay cargos automáticos por exceso ni se corta la atención de golpe.',
    en: 'The tiers cover 500, 2,000, 5,000, and 10,000 contacts per period. We alert you at 80% and at the limit. If you upgrade, you see and approve the prorated charge for the remaining time; the new monthly price starts at the next renewal. There are no automatic overage charges or sudden service cutoffs.',
  },
  faqTeamQuestion: {
    es: '¿Riverz reemplaza a mi equipo?',
    en: 'Does Riverz replace my team?',
  },
  faqTeamAnswer: {
    es: 'Se ocupa de tareas repetitivas y seguimientos. Tu equipo conserva las decisiones que requieren criterio y puede intervenir en las conversaciones. Definimos contigo qué queda automático y qué necesita aprobación.',
    en: 'It handles repetitive tasks and follow-ups. Your team keeps decisions that need judgment and can join conversations. Together, we define what runs automatically and what needs approval.',
  },
  faqMistakesQuestion: {
    es: '¿Qué pasa si el agente no sabe qué responder?',
    en: 'What happens when the agent does not know the answer?',
  },
  faqMistakesAnswer: {
    es: 'Trabaja con tu catálogo, tus políticas y tus reglas. Si falta información o el caso requiere una decisión sensible, puede pasar a tu equipo. Probamos contigo las respuestas y los límites antes de activarlo.',
    en: 'It works with your catalog, policies, and rules. Missing information or sensitive decisions can go to your team. We test responses and limits with you before activation.',
  },
  faqVoiceQuestion: {
    es: '¿Va a sonar como mi marca?',
    en: 'Will it sound like my brand?',
  },
  faqVoiceAnswer: {
    es: 'Sí, y como tu cliente. Defines la persona, el tono y las reglas de tu negocio; el agente escribe en el español del cliente que atiende (de vos en Buenos Aires, de tú en Bogotá), en mensajes cortos, sin listas ni formato de robot. Puedes probarlo con conversaciones reales y ajustarlo antes de publicarlo.',
    en: 'Yes, and like your customer. You define the persona, tone, and business rules; the agent writes in your customer’s own language and register, in short messages with no lists or robotic formatting. You can test it against real conversations and adjust it before publishing.',
  },
  faqChangeQuestion: {
    es: '¿Tengo que cambiar mi tienda o mis sistemas?',
    en: 'Do I have to replace my store or systems?',
  },
  faqChangeAnswer: {
    es: 'Trabajamos con las conexiones disponibles para tu tienda y tus canales. Si necesitas una integración personalizada, revisamos su viabilidad, alcance y plazo antes de acordarla.',
    en: 'We work with available connections for your store and channels. For custom integrations, we review feasibility, scope, and timing before agreeing on the work.',
  },
  faqControlQuestion: {
    es: '¿Quién controla mis cuentas y permisos?',
    en: 'Who controls my accounts and permissions?',
  },
  faqControlAnswer: {
    es: 'Tú. Las cuentas siguen siendo de tu negocio; Riverz se conecta por las APIs oficiales de Meta, con App Review aprobado, y tú decides qué puede hacer solo, qué requiere aprobación y quién de tu equipo tiene acceso. Cada acción queda registrada y se puede deshacer.',
    en: 'You do. Your business keeps ownership of its accounts; Riverz connects through Meta’s official APIs, with App Review approved, and you decide what it can do on its own, what requires approval, and who on your team has access. Every action is logged and can be undone.',
  },
  faqMeasureQuestion: {
    es: '¿Cómo sé si Riverz está funcionando?',
    en: 'How do I know Riverz is working?',
  },
  faqMeasureAnswer: {
    es: 'Con números, no con sensaciones. Ves conversaciones resueltas, pedidos creados y ventas atribuidas a cada flujo, al lado de lo que pagas. Si un flujo no produce, se nota en la primera semana y se ajusta. La calculadora sirve para explorar escenarios; el panel muestra lo que pasó de verdad.',
    en: 'With numbers, not feelings. You see resolved conversations, orders created, and sales attributed to each workflow, next to what you pay. If a workflow does not produce, it shows within the first week and gets adjusted. The calculator explores scenarios; the dashboard shows what actually happened.',
  },
  faqModelQuestion: {
    es: '¿Qué inteligencia artificial usa?',
    en: 'Which AI does it use?',
  },
  faqModelAnswer: {
    es: 'Los modelos de Anthropic (Claude), que hoy son los mejores del mercado para seguir reglas y no inventar. Y no nos casamos con uno: cada vez que aparece un modelo mejor lo medimos contra conversaciones reales de nuestros clientes antes de activarlo. Tú no tienes que elegir ni configurar nada; siempre atiende con lo mejor disponible.',
    en: 'Anthropic’s Claude models, which today are the best on the market at following rules and not making things up. And we are not married to one: whenever a better model appears, we measure it against our customers’ real conversations before switching it on. You never have to choose or configure anything; it always serves with the best available.',
  },
  faqCallsQuestion: {
    es: '¿Las llamadas están incluidas?',
    en: 'Are calls included?',
  },
  faqCallsAnswer: {
    es: 'El agente de voz sí, en todos los planes: confirma pedidos, recupera carritos y atiende llamadas entrantes con la misma información que el chat. El número y los minutos van aparte porque cambian según el país; los ves por separado y puedes fijar un límite mensual antes de escalar.',
    en: 'The voice agent is, on every plan: it confirms orders, recovers carts, and answers inbound calls with the same information as the chat. The number and minutes are separate because they vary by country; you see them itemized and can set a monthly cap before scaling.',
  },
  faqCommitmentQuestion: { es: '¿Hay permanencia?', en: 'Is there a lock-in?' },
  faqCommitmentAnswer: {
    es: 'No. El plan es mensual y lo cancelas cuando quieras; sigue activo hasta el final del período que ya pagaste. Tus cuentas, tus conversaciones y tus clientes son tuyos, con o sin Riverz.',
    en: 'No. The plan is monthly and you can cancel whenever you want; it stays active until the end of the period you already paid for. Your accounts, conversations, and customers are yours, with or without Riverz.',
  },
  // ── Confianza ──
  // Cada canal compatible usa su integración autorizada; cada proveedor
  // conserva sus propias políticas y límites.
  trustTitle: {
    es: 'Tus canales, por la vía oficial.',
    en: 'Your channels, connected the official way.',
  },
  trustBody: {
    es: 'Conectamos WhatsApp, Instagram, Messenger, correo, Mercado Libre, comentarios de TikTok y chat web mediante las integraciones disponibles para cada canal. En Meta usamos APIs oficiales con App Review aprobado. Cada cuenta sigue sujeta a las políticas de su plataforma.',
    en: 'We connect WhatsApp, Instagram, Messenger, email, Mercado Libre, TikTok comments, and web chat through each channel’s available integrations. For Meta, we use official APIs with App Review approved. Each account remains subject to its platform’s policies.',
  },
  trustPill: {
    es: 'Tus cuentas siguen siendo tuyas',
    en: 'Your accounts stay yours',
  },
  // Las dos vueltas del sello.
  trustSealTop: { es: 'Conexiones autorizadas', en: 'Authorized connections' },
  trustSealRing: {
    es: 'CANALES CONECTADOS · INTEGRACIONES AUTORIZADAS',
    en: 'CONNECTED CHANNELS · AUTHORIZED INTEGRATIONS',
  },

  // ── Cierre ──
  // Sin promesa de instalación: eso vive en la oferta, que es temporal.
  ctaTitle: {
    es: 'Cuéntanos qué te está quitando tiempo.',
    en: 'Tell us what’s taking up your time.',
  },
  ctaBody: {
    es: 'Déjanos tu correo. Revisamos tus canales, las tareas que quieres delegar y el plan que necesitas. Una conversación, sin compromiso.',
    en: 'Leave your email. We’ll review your channels, the work you want to delegate, and the plan you need. A conversation, with no commitment.',
  },
  chatCreativeLabel: {
    es: 'Ejemplo de funcionamiento',
    en: 'Illustrative workflow',
  },
  chatCreativeTyping: { es: 'Preparando respuesta', en: 'Preparing a reply' },
  chatCreativeCustomer: { es: 'Cliente', en: 'Customer' },
  chatCreativeTeam: { es: 'Tu equipo', en: 'Your team' },
  chatCreativeStock: { es: 'Stock verificado', en: 'Stock checked' },
  chatCreativeShipping: { es: 'Envío consultado', en: 'Shipping checked' },
  chatCreativeBuy: { es: 'Sí, quiero pedirlo.', en: 'Yes, I’d like to order.' },
  chatCreativeAddress: {
    es: 'Necesito cambiar la dirección.',
    en: 'I need to change the address.',
  },
  chatCreativeWait: {
    es: 'Lo reviso con el equipo.',
    en: 'I’ll check with the team.',
  },
  chatCreativeApproved: {
    es: 'Listo. Actualizamos tu dirección.',
    en: 'Done. Your address is updated.',
  },
  chatCreativePaid: { es: 'Ya hice el pago.', en: 'I’ve made the payment.' },
  chatCreativeConfirmed: {
    es: 'Pago confirmado. Tu pedido está listo.',
    en: 'Payment confirmed. Your order is ready.',
  },
  chatCreativeOrder: { es: 'Pedido confirmado', en: 'Order confirmed' },
  chatCreativeUnit: { es: '1 unidad', en: '1 item' },
  chatCreativeCase: { es: '¿Dónde está mi pedido?', en: 'Where is my order?' },
  chatCreativeTracking: {
    es: 'Ya va en camino. Aquí puedes seguirlo.',
    en: 'It’s on its way. Track it here.',
  },
  chatCreativeThread: { es: 'Ver conversación', en: 'View conversation' },
  chatCreativeResolved: { es: 'Resuelto', en: 'Resolved' },
  chatCreativeReview: { es: 'Necesita revisión', en: 'Needs review' },
  uiFilmQuestion: {
    es: '¿Tienen el perfume Solé?',
    en: 'Is Solé perfume available?',
  },
  uiFilmAnswer: {
    es: 'Sí, está disponible. ¿Te ayudo a pedirlo?',
    en: 'Yes, it’s available. Shall I help you order?',
  },
  uiFilmCheckout: {
    es: 'Aquí tienes el enlace para comprar.',
    en: 'Here’s your checkout link.',
  },
  uiFilmCheck: {
    es: 'Primero, consulta tu tienda.',
    en: 'First, check your store.',
  },
  uiFilmProduct: { es: 'Perfume Solé', en: 'Solé perfume' },
  uiFilmDestination: { es: 'Dirección del cliente', en: 'Customer’s address' },
  uiFilmAddressRequest: {
    es: '¿Aplicar la nueva dirección?',
    en: 'Apply the new address?',
  },
  uiFilmApproved: {
    es: 'Aprobado. Dirección actualizada.',
    en: 'Approved. Address updated.',
  },
  uiFilmToday: {
    es: 'La actividad, a la vista.',
    en: 'Your activity, in view.',
  },
  uiFilmHandled: { es: 'Atendidas', en: 'Handled' },
  uiFilmReview: { es: 'Por revisar', en: 'To review' },
  uiFilmExample: {
    es: 'Datos de ejemplo, no resultados reales.',
    en: 'Sample data, not actual results.',
  },
  uiFilmDemo: { es: 'Ejemplo', en: 'Example' },
  videoPlay: { es: 'Reproducir animación', en: 'Play animation' },
  videoPause: { es: 'Pausar animación', en: 'Pause animation' },
  videoIllustration: {
    es: 'Ejemplo de funcionamiento',
    en: 'Illustrative workflow',
  },
  videoConversation: {
    es: 'Una consulta. Una respuesta con contexto.',
    en: 'A question. A reply with context.',
  },
  videoPermissions: {
    es: 'Las acciones sensibles esperan tu aprobación.',
    en: 'Sensitive actions wait for your approval.',
  },
  videoOrder: {
    es: 'Ayuda a elegir. Facilita la compra.',
    en: 'Help them choose. Make checkout easier.',
  },
  videoResults: {
    es: 'Lo resuelto y lo que necesita a tu equipo.',
    en: 'What’s handled and what needs your team.',
  },
  motionReplay: { es: 'Repetir demostración', en: 'Replay demonstration' },
  motionInbox: { es: 'Conversaciones', en: 'Conversations' },
  motionAgent: { es: 'Agente de ventas', en: 'Sales agent' },
  motionQuestion: {
    es: '¿Tienen el modelo Aura en talla 39?',
    en: 'Is the Aura available in size 39?',
  },
  motionChecked: {
    es: 'Catálogo y disponibilidad consultados',
    en: 'Catalog and availability checked',
  },
  motionAnswer: {
    es: 'Sí, está disponible. Te comparto el modelo y el enlace para comprar.',
    en: 'Yes, it’s available. Here’s the product and your checkout link.',
  },
  motionProduct: { es: 'Tenis Aura', en: 'Aura sneakers' },
  motionVariant: { es: 'Talla 39 · Marfil', en: 'Size 39 · Ivory' },
  motionCheckout: { es: 'Enlace de compra enviado', en: 'Checkout link sent' },
  motionContext: { es: 'Contexto de la respuesta', en: 'Answer context' },
  motionCatalog: { es: 'Catálogo', en: 'Catalog' },
  motionStock: { es: 'Inventario', en: 'Inventory' },
  motionAvailable: { es: 'Disponible para comprar', en: 'Available to order' },
  motionDelivery: { es: 'Envío', en: 'Shipping' },
  motionShipping: {
    es: 'Según la dirección del cliente',
    en: 'Based on the customer’s address',
  },
  motionReady: { es: 'Lista para responder', en: 'Ready to reply' },
  motionGrounded: {
    es: 'Con información de tu tienda',
    en: 'Grounded in your store’s data',
  },
  motionPermissions: { es: 'Permisos del agente', en: 'Agent permissions' },
  motionRules: {
    es: 'Cada acción, bajo control',
    en: 'Every action, under control',
  },
  motionControl: {
    es: 'Tú decides hasta dónde llega',
    en: 'You set the boundaries',
  },
  motionTracking: { es: 'Consultar seguimiento', en: 'Look up tracking' },
  motionAddress: { es: 'Cambiar dirección', en: 'Change address' },
  motionRefund: { es: 'Revisar reembolso', en: 'Review refund' },
  motionAuto: { es: 'Automático', en: 'Automatic' },
  motionApproval: { es: 'Con aprobación', en: 'Approval required' },
  motionHuman: { es: 'Equipo humano', en: 'Human team' },
  motionWaiting: {
    es: 'Cambio pendiente de aprobación',
    en: 'Change awaiting approval',
  },
  motionNoChange: {
    es: 'La dirección aún no se modifica',
    en: 'The address remains unchanged',
  },
  motionOrders: { es: 'Del chat al pedido', en: 'From chat to order' },
  motionOrder: { es: 'Pedido de ejemplo', en: 'Example order' },
  motionLink: { es: 'Enlace de compra', en: 'Checkout link' },
  motionSent: { es: 'Enviado', en: 'Sent' },
  motionPayment: { es: 'Confirmación de pago', en: 'Payment confirmation' },
  motionVerified: { es: 'Recibida', en: 'Received' },
  motionOrderReady: { es: 'Pedido en la tienda', en: 'Order in your store' },
  motionSynced: { es: 'Sincronizado', en: 'Synced' },
  motionDone: {
    es: 'Cliente informado. Pedido registrado.',
    en: 'Customer notified. Order recorded.',
  },
  motionResults: { es: 'Resumen de actividad', en: 'Activity overview' },
  motionResolved: {
    es: 'Conversaciones resueltas',
    en: 'Resolved conversations',
  },
  motionWeek: { es: 'Últimos 7 días', en: 'Last 7 days' },
  motionChart: {
    es: 'Ejemplo ilustrativo de actividad durante siete días',
    en: 'Illustrative example of activity over seven days',
  },
  motionWeekStart: { es: 'Hace 7 días', en: '7 days ago' },
  motionToday: { es: 'Hoy', en: 'Today' },
  motionRecovered: { es: 'Compras recuperadas', en: 'Recovered purchases' },
  motionToReview: { es: 'Necesitan a tu equipo', en: 'Need your team' },
  motionTrace: {
    es: 'Cada resultado, con su conversación',
    en: 'Every result linked to its conversation',
  },
} satisfies Namespace;
