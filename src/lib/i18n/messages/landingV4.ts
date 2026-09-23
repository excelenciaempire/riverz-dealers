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
  // ── Metadatos ──
  metaTitle: { es: 'riverz', en: 'riverz' },
  metaDescription: {
    es: 'IA operativa para e-commerce. Riverz convierte mensajes, carritos y pagos pendientes en el siguiente paso de venta o postventa, con las reglas de tu negocio.',
    en: 'Operational AI for ecommerce. Riverz turns messages, abandoned carts, and pending payments into the next sales or post-purchase step, under your business rules.',
  },

  // ── Barra de aviso: la oferta, que es lo más fuerte que tenemos ──
  bannerLead: { es: 'Instalación gratis', en: 'Free setup' },
  bannerDiscount: { es: '{percent} % menos el primer mes', en: '{percent}% off month one' },
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
  navCta: { es: 'Solicitar acceso', en: 'Request access' },
  skipToContent: { es: 'Ir al contenido', en: 'Skip to content' },

  // ── Hero ──
  // El titular parte del punto de partida real del cliente: la tienda ya
  // vende. La bajada nombra el trabajo que se pierde entre intención y pedido,
  // sin pedirle que aprenda una categoría nueva.
  heroTitleLead: {
    es: 'Tu equipo de empleados de IA.',
    en: 'Your team of AI employees.',
  },
  heroTitleMuted: {
    es: 'Para vender, recuperar y atender.',
    en: 'Built to sell, recover, and support.',
  },
  heroSubtitle: {
    es: 'Convierte mensajes, carritos y pagos pendientes en el siguiente paso: vender, recuperar o atender. Todo con tu catálogo, tus pedidos y tus reglas.',
    en: 'Turn messages, abandoned carts, and pending payments into the next step: sell, recover, or support. All with your catalog, orders, and rules.',
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
    es: 'No termina en la respuesta. Sigue hasta el siguiente paso.',
    en: "It doesn't end with a reply. It continues to the next step.",
  },
  loopLead: {
    es: 'Riverz conecta cada conversación con la acción que corresponde: recomendar, recuperar una compra, confirmar un pedido o entregar el caso a tu equipo.',
    en: 'Riverz connects each conversation to the right action: recommend, recover a purchase, confirm an order, or hand the case to your team.',
  },
  // Cinco pasos, del lado del comercio. Sin «señal», sin «contexto», sin
  // «ejecuta»: nadie que vende por WhatsApp piensa con esas palabras.
  loop1Title: { es: 'Se entera', en: 'It notices' },
  loop1Body: {
    es: 'Un mensaje, un comentario, un carrito abandonado o un pago pendiente. Riverz reúne las señales que hoy quedan repartidas.',
    en: 'A message, a comment, an abandoned cart, or a pending payment. Riverz brings together the signals that are now scattered.',
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
    es: 'Sabe con quién habla',
    en: "It knows who it's talking to",
  },
  loop2Body: {
    es: 'Antes de responder, consulta el contexto disponible: catálogo, stock, pedidos e historial. Así la conversación no empieza desde cero.',
    en: "Before replying, it checks the available context: catalog, stock, orders, and history. So the conversation doesn't start from zero.",
  },
  loop2P1: {
    es: 'Catálogo, stock y precios en vivo',
    en: 'Live catalog, stock, and prices',
  },
  loop2P2: {
    es: 'Historial de compras y conversaciones',
    en: 'Purchase and conversation history',
  },

  loop3Title: {
    es: 'Decide hasta dónde llega',
    en: 'It decides how far to go',
  },
  loop3Body: {
    es: 'Tú defines qué puede hacer, qué debe aprobarse y qué debe escalarse. La IA trabaja dentro de esos límites.',
    en: 'You define what it can do, what needs approval, and what needs escalation. AI works within those limits.',
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
    es: 'Convierte la conversación en una acción',
    en: 'Turns the conversation into action',
  },
  loop4Body: {
    es: 'Puede recomendar productos, enviar un checkout o link de pago, crear o consultar pedidos y continuar la postventa, según tus conexiones y permisos.',
    en: 'It can recommend products, send checkout or payment links, create or look up orders, and continue post-purchase support, based on your connections and permissions.',
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
    es: 'Te muestra qué ganaste',
    en: 'It shows you what you earned',
  },
  loop5Body: {
    es: 'Ves qué resolvió la IA, qué quedó pendiente y qué resultados puedes atribuir a cada flujo cuando la fuente está conectada.',
    en: 'See what AI resolved, what remains pending, and which results you can attribute to each flow when the source is connected.',
  },
  loop5P1: {
    es: 'Resultados y conversaciones en un solo lugar',
    en: 'Results and conversations in one place',
  },
  loop5P2: {
    es: 'Mejora con las respuestas de tu equipo',
    en: "Improves with your team's answers",
  },

  // ── Los pilares: el ángulo del chat ya pagado ──
  // Esta sección es el PROBLEMA, y es lo único que dice que no diga otra.
  // Tenía además tres pilares —Recupera, Ejecuta, Delega— que repetían, uno por
  // uno, el titular de acá mismo, el de «La diferencia» y una viñeta del paso
  // 03. Se fueron los tres: en un teléfono eran media pantalla de texto ya
  // leído.
  pillarsTitle: {
    es: 'No pierdas la demanda que ya pagaste',
    en: "Don't lose the demand you already paid for",
  },
  pillarsLead: {
    es: 'Tu publicidad ya trajo conversaciones. Riverz les da continuidad para que una duda, un carrito o un pago pendiente no se enfríen sin seguimiento.',
    en: "Your ads already brought conversations. Riverz follows through so a question, cart, or pending payment doesn't go cold without follow-up.",
  },

  // ── Qué hace (la cuadrícula de fichas) ──
  capsTitle: {
    es: 'Una operación de e-commerce que sigue trabajando',
    en: 'An ecommerce operation that keeps working',
  },
  capsBody: {
    es: 'Ventas, recuperación, pedidos y postventa, bajo el control de tu equipo.',
    en: "Sales, recovery, orders, and post-purchase support, under your team's control.",
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

  // ── Operator ──
  // Este bloque va a todo el ancho y con la mínima cantidad de texto posible:
  // la animación tiene que contar la función sola. Un titular, una línea y el
  // chat. Lo que antes eran tres viñetas ahora lo dice el propio reparto.
  operatorTitle: {
    es: 'Pide el resultado. Riverz coordina el trabajo.',
    en: 'Ask for the result. Riverz coordinates the work.',
  },
  operatorLead: {
    es: 'Describe lo que necesitas en lenguaje simple. Riverz prepara el trabajo, coordina las acciones y te pide aprobación cuando hace falta.',
    en: 'Describe what you need in plain language. Riverz prepares the work, coordinates actions, and asks for approval when needed.',
  },

  // Lo que se escribe y lo que contesta, dentro de la animación.
  opPrompt: {
    es: 'Recupera los carritos de esta semana',
    en: "Recover this week's abandoned carts",
  },
  opLine1: {
    es: 'Segmenté 1.284 carritos de 7 días',
    en: 'Segmented 1,284 carts from the last 7 days',
  },
  // "Escribí" acá es pretérito de primera persona —el Operador contando lo que
  // hizo, junto a "Segmenté" y "Programé"—, no voseo rioplatense. Se marca para
  // que el barrido no lo confunda; cambiarlo rompería la frase.
  opLine2: {
    es: 'Escribí el mensaje con el producto', // no es voseo rioplatense: pretérito de 1ª persona
    en: 'Wrote the message with the product',
  }, // no es voseo rioplatense: pretérito de 1ª persona
  opLine3: {
    es: 'Programé el envío a las 3 horas',
    en: 'Scheduled the send for 3 hours later',
  },
  opAsk: { es: '¿Lo activo?', en: 'Shall I turn it on?' },
  opApprove: { es: 'Aprobar', en: 'Approve' },
  opNote: {
    es: 'Nada le llega a un cliente sin que lo apruebes.',
    en: 'Nothing reaches a customer without your approval.',
  },

  // ── Canales ──
  channelsTitle: {
    es: 'Donde ya te escriben tus clientes',
    en: 'Where your customers already write you',
  },
  channelsBody: {
    es: 'Siete bandejas, los comentarios de tus anuncios y las llamadas, en una sola pantalla. Y del otro lado, tu tienda y tus pagos.',
    en: 'Seven inboxes, the comments on your ads, and the calls, on one screen. And on the other side, your store and your payments.',
  },
  channelsInboxes: { es: 'Bandejas', en: 'Inboxes' },
  channelsStores: { es: 'Tiendas y logística', en: 'Stores and logistics' },
  channelsCalls: { es: 'Llamadas', en: 'Calls' },

  // ── Precios ──
  pricingTitleLead: { es: 'Todo Riverz.', en: 'All of Riverz.' },
  pricingTitleMuted: { es: 'Un precio simple.', en: 'One simple price.' },
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
  pricingPerContact: {
    es: '≈ {amount} centavos por contacto con el cupo completo',
    en: '≈ {amount} cents per contact at full plan capacity',
  },
  pricingEverythingIncluded: { es: 'Todo incluido', en: 'Everything included' },
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
    es: 'Operator, automatizaciones y aprobaciones',
    en: 'Operator, automations, and approvals',
  },
  pricingIncludedIntegrations: {
    es: 'Integraciones con tienda, pagos y logística',
    en: 'Store, payment, and logistics integrations',
  },
  pricingIncludedResults: {
    es: 'Resultados y ventas atribuidas',
    en: 'Results and attributed sales',
  },
  pricingDetailsNote: {
    es: 'Cada persona cuenta una vez por período si la IA le responde. Entre canales se une solo con identidad verificada. Sin excedentes automáticos. Mensajería y telefonía de terceros aparte.',
    en: 'Each person counts once per period if AI replies. Cross-channel contacts merge only with verified identity. No automatic overages. Third-party messaging and telephony are separate.',
  },
  pricingDetailsSummary: {
    es: 'Cómo se cuentan los contactos',
    en: 'How contacts are counted',
  },
  roiTitle: {
    es: 'Calcula el retorno posible',
    en: 'Estimate your potential return',
  },
  roiMetaTitle: { es: 'Calculadora de ROI de Riverz', en: 'Riverz ROI calculator' },
  roiMetaDescription: {
    es: 'Estima el retorno posible de Riverz con tus pedidos, ticket promedio y margen bruto.',
    en: 'Estimate Riverz’s potential return using your orders, average order value, and gross margin.',
  },
  roiPlanLabel: { es: 'Elige el volumen de contactos', en: 'Choose contact volume' },
  roiBackToPricing: { es: 'Volver a precios', en: 'Back to pricing' },
  roiOrdersLabel: { es: 'Pedidos actuales al mes', en: 'Current monthly orders' },
  roiTicketLabel: { es: 'Ticket promedio (US$)', en: 'Average order value (US$)' },
  roiMarginLabel: { es: 'Margen bruto (%)', en: 'Gross margin (%)' },
  roiUpliftLabel: { es: 'Aumento hipotético de pedidos (%)', en: 'Hypothetical order increase (%)' },
  roiCustomPriceLabel: { es: 'Precio mensual acordado (US$)', en: 'Agreed monthly price (US$)' },
  roiEstimatedReturn: { es: 'ROI posible al mes', en: 'Potential monthly ROI' },
  roiExtraOrders: { es: 'Pedidos adicionales', en: 'Additional orders' },
  roiAdditionalMargin: { es: 'Margen adicional', en: 'Additional gross profit' },
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
  // Cada respuesta afirma sólo lo que el producto hace hoy. La seguridad viene
  // de decirlo sin rodeos, no de prometer lo que no se puede mostrar.
  faqIncludedQuestion: { es: '¿Qué incluye el plan?', en: 'What does the plan include?' },
  faqIncludedAnswer: {
    es: 'Todo. No hay módulos ni escalones: cada plan trae los agentes de ventas, recuperación, soporte y postventa; todos los canales, el chat web y la voz; el Operator, las automatizaciones y las aprobaciones; las integraciones con tu tienda, tus pagos y tu logística; y las ventas atribuidas a cada flujo. El consumo de IA va incluido, sin importar cuánto conversen tus clientes. Lo único aparte son los cargos externos de mensajería y telefonía, que te mostramos al centavo.',
    en: 'Everything. There are no modules or tiers of features: every plan includes the sales, recovery, support, and post-purchase agents; every channel, web chat, and voice; the Operator, automations, and approvals; integrations with your store, payments, and logistics; and sales attributed to each workflow. AI usage is included no matter how much your customers talk. The only separate items are external messaging and telephony charges, which we show you to the cent.',
  },
  faqWhyQuestion: { es: '¿Por qué Riverz y no un chatbot o un CRM de WhatsApp?', en: 'Why Riverz instead of a chatbot or a WhatsApp CRM?' },
  faqWhyAnswer: {
    es: 'Porque casi todo lo demás termina en “respuesta enviada” y deja la venta para que la cierre una persona. Riverz atiende la conversación completa hasta el resultado: cotiza con el precio real de tu catálogo, arma el pedido, manda el link de pago, registra el comprobante, recupera el carrito abandonado y avisa cuando el envío sale. Un CRM te ordena el trabajo; Riverz lo hace.',
    en: 'Because almost everything else stops at “reply sent” and leaves the sale for a person to close. Riverz takes the whole conversation to the outcome: it quotes the real price from your catalog, builds the order, sends the payment link, records the receipt, recovers the abandoned cart, and lets the customer know when the shipment leaves. A CRM organizes the work; Riverz does it.',
  },
  faqSellsQuestion: { es: '¿Vende de verdad o solo contesta?', en: 'Does it actually sell, or just reply?' },
  faqSellsAnswer: {
    es: 'Vende. El agente tiene manos, no solo voz: consulta el pedido en tu tienda, crea el checkout con la oferta correcta, genera links de pago, registra transferencias, aplica solo los descuentos que tú autorizaste y, si hace falta, llama por teléfono. Cada venta queda atribuida a la conversación que la cerró, así que ves exactamente qué produjo.',
    en: 'It sells. The agent has hands, not just a voice: it looks up the order in your store, creates the checkout with the right offer, generates payment links, records bank transfers, applies only the discounts you authorized and, when needed, places a phone call. Every sale is attributed to the conversation that closed it, so you see exactly what it produced.',
  },
  faqSetupQuestion: { es: '¿Cuánto tarda en estar funcionando?', en: 'How long until it is running?' },
  faqSetupAnswer: {
    es: 'Días, no meses. La instalación la hacemos nosotros: conectamos tus canales, tu tienda y tus pagos, cargamos tu catálogo y tus reglas, y activamos primero el flujo que más plata mueve en tu operación. Tú apruebas cómo habla el agente antes de que atienda a un solo cliente.',
    en: 'Days, not months. We do the setup: we connect your channels, store, and payments, load your catalog and rules, and switch on the workflow that moves the most money in your operation first. You approve how the agent talks before it serves a single customer.',
  },
  faqFirstMonthQuestion: {
    es: '¿Qué pago al comenzar?',
    en: 'What do I pay to get started?',
  },
  faqFirstMonthAnswer: {
    es: 'La instalación y configuración son gratis. Cuando apruebas lo que montamos, pagas el primer mes con {percent} % de descuento. Desde el segundo mes pagas el precio normal de tu plan. No hay permanencia.',
    en: 'Setup and configuration are free. Once you approve what we built, you pay the first month at {percent}% off. From month two, you pay your plan’s regular price. There is no lock-in.',
  },
  faqCountingQuestion: { es: '¿Qué significa “contactos atendidos al mes”?', en: 'What does “contacts served per month” mean?' },
  faqCountingAnswer: {
    es: 'Contamos cada contacto al que la IA envía al menos una respuesta durante tu período de facturación. Si usa varios canales y podemos verificar que es la misma persona, cuenta una sola vez. No cobramos cada mensaje ni cada conversación.',
    en: 'We count each contact who receives at least one AI reply during your billing period. If they use multiple channels and we can verify they are the same person, they count once. We do not charge per message or conversation.',
  },
  faqGrowthQuestion: { es: '¿Qué pasa si mi tienda crece?', en: 'What happens if my store grows?' },
  faqGrowthAnswer: {
    es: 'Los rangos son 500, 2.000, 5.000 y 10.000 contactos por período. Te avisamos al 80 % y al llegar al límite. Puedes ampliar el plan desde tu cuenta: tienes más capacidad de inmediato y el nuevo precio se cobra en la siguiente renovación. No hay cargos automáticos por exceso ni se corta la atención de golpe.',
    en: 'The tiers cover 500, 2,000, 5,000, and 10,000 contacts per period. We alert you at 80% and at the limit. You can upgrade in your account: capacity increases immediately and the new price starts at the next renewal. There are no automatic overage charges or sudden service cutoffs.',
  },
  faqTeamQuestion: { es: '¿Riverz reemplaza a mi equipo?', en: 'Does Riverz replace my team?' },
  faqTeamAnswer: {
    es: 'Reemplaza lo repetitivo y multiplica lo demás. El agente atiende a las tres de la mañana, a cincuenta personas a la vez, sin dejar a nadie en visto. Cuando un caso necesita criterio, lo entrega a tu equipo con todo el contexto y un resumen de qué pasó. Tú fijas los límites, qué requiere aprobación y en qué momento exacto interviene una persona.',
    en: 'It replaces the repetitive part and multiplies the rest. The agent serves customers at three in the morning, fifty at a time, without leaving anyone on read. When a case needs judgment, it hands it to your team with full context and a summary of what happened. You set the limits, what requires approval, and the exact moment a person steps in.',
  },
  faqMistakesQuestion: { es: '¿Qué pasa si el agente no sabe qué responder?', en: 'What happens when the agent does not know the answer?' },
  faqMistakesAnswer: {
    es: 'Lo dice, y lo confirma con alguien. Riverz no inventa precios, ingredientes, plazos ni aprobaciones sanitarias: trabaja solo con el conocimiento y las reglas que aprobaste, y un control aparte verifica cada precio que cita contra tu catálogo antes de enviarlo. Si falta un dato o aparece una excepción, pide aprobación o pasa el caso a una persona con todo el contexto.',
    en: 'It says so, and confirms with someone. Riverz does not make up prices, ingredients, delivery times, or regulatory approvals: it works only with the knowledge and rules you approved, and a separate check verifies every price it quotes against your catalog before sending. When data is missing or an exception appears, it requests approval or hands the case to a person with full context.',
  },
  faqVoiceQuestion: { es: '¿Va a sonar como mi marca?', en: 'Will it sound like my brand?' },
  faqVoiceAnswer: {
    es: 'Sí, y como tu cliente. Defines la persona, el tono y las reglas de tu negocio; el agente escribe en el español del cliente que atiende (de vos en Buenos Aires, de tú en Bogotá), en mensajes cortos, sin listas ni formato de robot. Puedes probarlo con conversaciones reales y ajustarlo antes de publicarlo.',
    en: 'Yes, and like your customer. You define the persona, tone, and business rules; the agent writes in your customer’s own language and register, in short messages with no lists or robotic formatting. You can test it against real conversations and adjust it before publishing.',
  },
  faqChangeQuestion: { es: '¿Tengo que cambiar mi tienda o mis sistemas?', en: 'Do I have to replace my store or systems?' },
  faqChangeAnswer: {
    es: 'No. Riverz se conecta a lo que ya usas: Shopify, Tiendanube, WooCommerce y Mercado Libre; WhatsApp, Instagram, Messenger, TikTok, correo y chat web; tus pagos y tu logística. Tu operación actual sigue siendo la base; nosotros le ponemos el equipo encima.',
    en: 'No. Riverz connects to what you already use: Shopify, Tiendanube, WooCommerce, and Mercado Libre; WhatsApp, Instagram, Messenger, TikTok, email, and web chat; your payments and logistics. Your current operation remains the foundation; we put the team on top of it.',
  },
  faqControlQuestion: { es: '¿Quién controla mis cuentas y permisos?', en: 'Who controls my accounts and permissions?' },
  faqControlAnswer: {
    es: 'Tú. Las cuentas siguen siendo de tu negocio; Riverz se conecta por las APIs oficiales de Meta, con App Review aprobado, y tú decides qué puede hacer solo, qué requiere aprobación y quién de tu equipo tiene acceso. Cada acción queda registrada y se puede deshacer.',
    en: 'You do. Your business keeps ownership of its accounts; Riverz connects through Meta’s official APIs, with App Review approved, and you decide what it can do on its own, what requires approval, and who on your team has access. Every action is logged and can be undone.',
  },
  faqMeasureQuestion: { es: '¿Cómo sé si Riverz está funcionando?', en: 'How do I know Riverz is working?' },
  faqMeasureAnswer: {
    es: 'Con números, no con sensaciones. Ves conversaciones resueltas, pedidos creados y ventas atribuidas a cada flujo, al lado de lo que pagas. Si un flujo no produce, se nota en la primera semana y se ajusta. La calculadora sirve para explorar escenarios; el panel muestra lo que pasó de verdad.',
    en: 'With numbers, not feelings. You see resolved conversations, orders created, and sales attributed to each workflow, next to what you pay. If a workflow does not produce, it shows within the first week and gets adjusted. The calculator explores scenarios; the dashboard shows what actually happened.',
  },
  faqModelQuestion: { es: '¿Qué inteligencia artificial usa?', en: 'Which AI does it use?' },
  faqModelAnswer: {
    es: 'Los modelos de Anthropic (Claude), que hoy son los mejores del mercado para seguir reglas y no inventar. Y no nos casamos con uno: cada vez que aparece un modelo mejor lo medimos contra conversaciones reales de nuestros clientes antes de activarlo. Tú no tienes que elegir ni configurar nada; siempre atiende con lo mejor disponible.',
    en: 'Anthropic’s Claude models, which today are the best on the market at following rules and not making things up. And we are not married to one: whenever a better model appears, we measure it against our customers’ real conversations before switching it on. You never have to choose or configure anything; it always serves with the best available.',
  },
  faqCallsQuestion: { es: '¿Las llamadas están incluidas?', en: 'Are calls included?' },
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
  // Todo lo de acá es verificable. No decimos «Meta Business Partner»: ese es
  // un programa cerrado con su propio directorio y su propia insignia, y usar
  // el sello sin estar adentro va contra las normas de marca de Meta y pone en
  // riesgo la app. Lo que sí es cierto —y es lo que de verdad tranquiliza— es
  // que la conexión es por la API oficial y que el App Review está aprobado.
  // Una frase y una descripción. Nada más.
  //
  // Acá hubo primero cuatro bloques de título + párrafo (noventa palabras) y
  // después cinco insignias de texto. Las dos versiones explicaban; ninguna
  // tranquilizaba. Quien lee esto no quiere el detalle técnico de cómo nos
  // conectamos: quiere saber que no se le va a caer nada encima. Eso se dice
  // en una línea y se prueba con un sello, no con una lista.
  trustTitle: {
    es: 'Conexiones oficiales. Control real.',
    en: 'Official connections. Real control.',
  },
  trustBody: {
    es: 'Riverz conecta los canales de Meta mediante sus APIs oficiales. Tu negocio conserva sus cuentas y tú defines permisos, aprobaciones y acceso del equipo.',
    en: 'Riverz connects Meta channels through their official APIs. Your business keeps its accounts, and you define permissions, approvals, and team access.',
  },
  trustPill: {
    es: 'Tú defines los límites',
    en: 'You define the limits',
  },
  // Las dos vueltas del sello.
  trustSealTop: { es: 'Conexión oficial', en: 'Official connection' },
  trustSealRing: {
    es: 'API OFICIAL DE META · APP REVIEW APROBADO',
    en: 'OFFICIAL META API · APP REVIEW APPROVED',
  },

  // ── Cierre ──
  // Sin promesa de instalación: eso vive en la oferta, que es temporal.
  ctaTitle: {
    es: 'Conecta lo que ya tienes. Nosotros montamos la operación.',
    en: "Connect what you already use. We'll build the operation.",
  },
  ctaBody: {
    es: 'Déjanos tu correo. Revisamos tu operación y configuramos el primer flujo que tenga sentido para tu tienda.',
    en: "Leave your email. We'll review your operation and configure the first flow that makes sense for your store.",
  },
} satisfies Namespace;
