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
 *    Instalación gratis, la configuramos nosotros, y el pago empieza cuando ya
 *    esté demostrando el valor acordado. Eso mata de una la objeción más
 *    grande del avatar («integrarlo va a ser otro proyecto de meses»).
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
  bannerText: {
    es: 'la configuramos contigo y empiezas a pagar cuando demuestre el resultado acordado.',
    en: 'we set it up with you, and you start paying once it demonstrates the agreed result.',
  },
  bannerVer: { es: 'Ver cómo', en: 'See how' },
  cerrar: { es: 'Cerrar', en: 'Close' },

  // ── Navegación ──
  // El enlace dice lo mismo que la etiqueta de la sección a la que lleva: si
  // no coinciden, quien hace clic cree que aterrizó en otro lado.
  navLoop: { es: 'La diferencia', en: 'The difference' },
  navCapabilities: { es: 'Qué hace', en: 'What it does' },
  navOperator: { es: 'Operator', en: 'Operator' },
  navChannels: { es: 'Canales', en: 'Channels' },
  navPricing: { es: 'Precios', en: 'Pricing' },
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
  launch5Title: { es: 'Pagas después', en: 'You pay later' },
  launch5Body: {
    es: 'La instalación no cuesta. El plan arranca cuando ya funciona.',
    en: 'Setup is free. The plan starts once it works.',
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
    es: 'Contactos atendidos al mes',
    en: 'Contacts served per month',
  },
  pricingUpToCustomers: {
    es: 'Hasta {count} contactos atendidos al mes',
    en: 'Up to {count} contacts served per month',
  },
  pricingCustomVolume: {
    es: 'Más de 10.000 contactos atendidos al mes',
    en: 'More than 10,000 contacts served per month',
  },
  pricingTierMore: { es: '10k+', en: '10k+' },
  pricingPerMonth: { es: 'al mes', en: 'per month' },
  pricingCustomPrice: { es: 'Hablemos', en: "Let's talk" },
  pricingPerContact: { es: '{amount} por contacto atendido', en: '{amount} per contact served' },
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
    es: 'Cada cliente cuenta una sola vez al mes. Los cargos externos de mensajería y llamadas se facturan por separado.',
    en: 'Each customer counts once per month. External messaging and call charges are billed separately.',
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
  faqIncludedQuestion: { es: '¿Qué incluye cada plan?', en: 'What does each plan include?' },
  faqIncludedAnswer: {
    es: 'No compras un módulo recortado: cualquier plan incluye agentes de ventas, recuperación, soporte y postventa; canales conectados, automatizaciones, aprobaciones, integraciones y resultados atribuidos. El consumo de IA también está incluido. Solo van aparte los cargos externos de mensajería y telefonía.',
    en: 'You are not buying a stripped-down module: every plan includes sales, recovery, support, and post-purchase agents; connected channels, automations, approvals, integrations, and attributed results. AI usage is included too. Only external messaging and telephony charges are separate.',
  },
  faqWhyQuestion: { es: '¿Por qué Riverz y no otro software?', en: 'Why Riverz instead of another software?' },
  faqWhyAnswer: {
    es: 'Muchos softwares terminan en “respuesta enviada”. Riverz lleva la conversación hasta el siguiente paso: vender, recuperar un carrito, resolver un caso o entregar la postventa. Todo queda bajo tus reglas, con aprobaciones humanas cuando hacen falta y resultados atribuidos por flujo.',
    en: 'Many software tools stop at “reply sent.” Riverz takes the conversation to the next step: sell, recover a cart, resolve a case, or handle post-purchase. Everything follows your rules, with human approvals when needed and results attributed by workflow.',
  },
  faqCountingQuestion: { es: '¿Qué significa “contactos atendidos al mes”?', en: 'What does “contacts served per month” mean?' },
  faqCountingAnswer: {
    es: 'Es el número de personas únicas que conversan con Riverz durante el mes. Una persona que escribe por Instagram, WhatsApp y luego vuelve a escribir sigue contando una sola vez. Así, el primer rango cubre hasta 500 contactos únicos y el siguiente hasta 2.000, sin cobrarte tres veces por la misma persona.',
    en: 'It is the number of unique people who converse with Riverz during the month. Someone who writes on Instagram, WhatsApp, and then returns still counts once. The first tier therefore covers up to 500 unique contacts and the next up to 2,000, without charging three times for the same person.',
  },
  faqGrowthQuestion: { es: '¿Qué pasa si mi tienda crece?', en: 'What happens if my store grows?' },
  faqGrowthAnswer: {
    es: 'La escala es simple: hasta 500, 2.000, 5.000 y 10.000 contactos únicos al mes. Si tu operación pasa de 500 a 650 contactos, subes al rango de 2.000; si esos mismos 500 contactos compran más, el plan no cambia. Tu crecimiento comercial no se convierte automáticamente en una penalización.',
    en: 'The scale is simple: up to 500, 2,000, 5,000, and 10,000 unique contacts per month. If your operation grows from 500 to 650 contacts, you move to the 2,000 tier; if those same 500 contacts buy more, your plan does not change. Commercial growth does not automatically become a penalty.',
  },
  faqTeamQuestion: { es: '¿Riverz reemplaza a mi equipo?', en: 'Does Riverz replace my team?' },
  faqTeamAnswer: {
    es: 'No tienes que elegir entre automatizar y cuidar la experiencia. Riverz resuelve lo repetitivo y, cuando un caso necesita criterio, entrega la conversación con su contexto al equipo. Tú decides los límites, las aprobaciones y el momento exacto del traspaso.',
    en: 'You do not have to choose between automation and a careful customer experience. Riverz handles repetitive work and hands the conversation, with its context, to your team when judgment is needed. You decide the limits, approvals, and exact handoff moment.',
  },
  faqMistakesQuestion: { es: '¿Qué pasa si el agente no sabe qué responder?', en: 'What happens when the agent does not know what to say?' },
  faqMistakesAnswer: {
    es: 'Riverz no rellena los silencios inventando una respuesta. El agente usa el conocimiento y las reglas que apruebas; si falta información o aparece una excepción, el caso puede pedir aprobación o pasar a una persona con todo el contexto. No prometemos respuestas perfectas ni ventas garantizadas.',
    en: 'Riverz does not fill gaps by making up an answer. The agent uses the knowledge and rules you approve; when information is missing or an exception appears, it can request approval or hand the case to a person with full context. We do not promise perfect answers or guaranteed sales.',
  },
  faqChangeQuestion: { es: '¿Tengo que cambiar mi tienda o mis sistemas?', en: 'Do I have to replace my store or systems?' },
  faqChangeAnswer: {
    es: 'No tienes que desarmar lo que ya funciona. Riverz se conecta con tus canales, tienda, pagos y logística; después activamos primero el flujo que más impacto tenga —por ejemplo, recuperar carritos— y ampliamos desde ahí. Tu sistema actual sigue siendo la base.',
    en: 'You do not have to dismantle what already works. Riverz connects with your channels, store, payments, and logistics; then we start with the workflow that can have the most impact—such as recovering carts—and expand from there. Your current system remains the foundation.',
  },
  faqControlQuestion: { es: '¿Quién controla mis cuentas y permisos?', en: 'Who controls my accounts and permissions?' },
  faqControlAnswer: {
    es: 'Las cuentas siguen siendo de tu negocio. Riverz se conecta mediante las APIs oficiales de Meta y tú eliges los permisos, las acciones que requieren aprobación y las personas de tu equipo con acceso. La automatización trabaja dentro de los límites que tú defines.',
    en: 'Your business keeps ownership of its accounts. Riverz connects through Meta’s official APIs, and you choose the permissions, actions that require approval, and team members with access. Automation works within the limits you define.',
  },
  faqMeasureQuestion: { es: '¿Cómo sé si Riverz está funcionando?', en: 'How do I know Riverz is working?' },
  faqMeasureAnswer: {
    es: 'No tienes que confiar en una sensación. Puedes revisar conversaciones resueltas, pedidos y ventas atribuidas a cada flujo cuando la fuente está conectada, y comparar ese resultado con tu inversión. La calculadora sirve para explorar escenarios; el resultado real depende de tu operación.',
    en: 'You do not have to rely on a feeling. When the source is connected, you can review resolved conversations, orders, and sales attributed to each workflow and compare them with your investment. The calculator helps explore scenarios; actual results depend on your operation.',
  },
  faqCallsQuestion: { es: '¿Las llamadas están incluidas?', en: 'Are calls included?' },
  faqCallsAnswer: {
    es: 'El agente de voz está disponible en todos los planes. El número y los minutos se cobran aparte porque cambian según el país y el uso; los mostramos por separado para que sepas qué pagas y puedas fijar límites antes de escalar.',
    en: 'The voice agent is available on every plan. Number and minute charges are separate because they vary by country and usage; we show them separately so you know what you pay and can set limits before scaling.',
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
