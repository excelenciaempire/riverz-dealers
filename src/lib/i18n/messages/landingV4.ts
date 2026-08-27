import type { Namespace } from "./types";

/**
 * Copy de la portada editorial (riverz.co/portada-b).
 *
 * Este archivo sigue la investigación de mercado del 26 de agosto de 2026
 * (`investigacion-mercado-avatar-funcionalidades-riverz.md`). Cuatro cosas de
 * ahí mandan sobre todo lo demás:
 *
 * 1. **La categoría no es «chatbot» ni «agentes de IA».** Es IA OPERATIVA para
 *    e-commerce. La idea entera cabe en una frase: *la IA que no solo conversa,
 *    opera tu tienda*. Ese es el titular.
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
 * 4. **Dos mecanismos con nombre propio.** Riverz Launch —nosotros lo
 *    montamos— y Riverz Loop —los cinco pasos que mantienen cada oportunidad
 *    en movimiento—. Un chatbot termina cuando responde; el Loop termina
 *    cuando la oportunidad avanzó o quedó en manos de la persona correcta.
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
  metaTitle: { es: "riverz", en: "riverz" },
  metaDescription: {
    es: "La IA que no solo conversa: opera tu tienda. Reúne tus canales, tu catálogo y tus pedidos, y se encarga del siguiente paso: recomendar, cobrar, crear el pedido, recuperar el carrito o pasarte el caso.",
    en: "The AI that doesn't just chat: it runs your store. It brings together your channels, catalog, and orders, and takes the next step: recommend, charge, create the order, recover the cart, or hand you the case.",
  },

  // ── Barra de aviso: la oferta, que es lo más fuerte que tenemos ──
  bannerLead: { es: "Instalación gratis", en: "Free setup" },
  bannerText: {
    es: "la configuramos contigo y empiezas a pagar cuando ya esté dando resultados.",
    en: "we set it up with you, and you start paying once it's already delivering.",
  },

  // ── Navegación ──
  navLaunch: { es: "Cómo empiezas", en: "Getting started" },
  navLoop: { es: "Cómo opera", en: "How it operates" },
  navCapabilities: { es: "Qué hace", en: "What it does" },
  navOperator: { es: "Operator", en: "Operator" },
  navChannels: { es: "Canales", en: "Channels" },
  navCta: { es: "Conectar mi tienda", en: "Connect my store" },
  skipToContent: { es: "Ir al contenido", en: "Skip to content" },

  // ── Hero ──
  // El titular es la definición de categoría, no una lista de canales.
  heroTitleLead: { es: "No solo conversa.", en: "It doesn't just chat." },
  heroTitleMuted: { es: "Opera tu tienda.", en: "It runs your store." },
  heroSubtitle: {
    es: "Riverz reúne tus canales, tu catálogo y tus pedidos para que la IA se encargue del siguiente paso: recomendar, cobrar, crear el pedido, recuperar un carrito, avisar la entrega o pasarte el caso cuando hace falta una persona.",
    en: "Riverz brings together your channels, your catalog, and your orders so the AI can take the next step: recommend, charge, create the order, recover a cart, report a delivery, or hand you the case when a person is needed.",
  },

  // ── Muro de plataformas ──
  wallLabel: { es: "Se conecta con", en: "Connects to" },

  // ── Riverz Launch: la oferta, en pasos ──
  launchLabel: { es: "Riverz Launch", en: "Riverz Launch" },
  launchTitle: {
    es: "No tienes que configurar nada",
    en: "You don't have to set anything up",
  },
  launchBody: {
    es: "La mayoría de las herramientas te entrega un panel vacío y te desea suerte. Aquí entra como entra un empleado que ya sabe trabajar: conectas la tienda y el resto lo montamos nosotros.",
    en: "Most tools hand you an empty dashboard and wish you luck. This arrives the way a new hire does when they already know the job: you connect the store, and we build the rest.",
  },
  launch1Title: { es: "Conectas tu tienda y tus canales", en: "You connect your store and channels" },
  launch1Body: {
    es: "Unos cuantos clics. No tienes que diseñar la operación ni dibujar cien caminos antes de saber si sirve.",
    en: "A few clicks. No operation to design, no hundred branches to draw before you know if it works.",
  },
  launch2Title: { es: "Riverz estudia tu marca", en: "Riverz studies your brand" },
  launch2Body: {
    es: "Revisa el catálogo, las políticas, el tono, los pedidos y lo que hoy hace tu equipo a mano.",
    en: "It reviews the catalog, the policies, the tone, the orders, and what your team does by hand today.",
  },
  launch3Title: { es: "Nosotros configuramos todo", en: "We configure everything" },
  launch3Body: {
    es: "Los agentes, los flujos, los seguimientos, las aprobaciones y los límites. No lo dejamos de tu lado.",
    en: "The agents, the flows, the follow-ups, the approvals, and the limits. We don't leave it on your side.",
  },
  launch4Title: { es: "Tú revisas y apruebas", en: "You review and approve" },
  launch4Body: {
    es: "Nada le escribe a un cliente hasta que estés conforme con lo que va a decir y con lo que puede hacer.",
    en: "Nothing writes to a customer until you're happy with what it will say and what it's allowed to do.",
  },
  launch5Title: { es: "Empiezas a pagar después", en: "You start paying later" },
  launch5Body: {
    es: "La instalación no cuesta y te acompañamos hasta que la operación muestre el valor que acordamos. Recién ahí arranca el plan.",
    en: "Setup is free and we stay with you until the operation shows the value we agreed on. Only then does the plan start.",
  },

  // ── Riverz Loop: el mecanismo ──
  loopLabel: { es: "Riverz Loop", en: "Riverz Loop" },
  loopTitle: {
    es: "Un chatbot termina cuando responde",
    en: "A chatbot is done when it replies",
  },
  loopLead: {
    es: "El Loop termina cuando la oportunidad avanzó, o cuando quedó en manos de la persona correcta. Cinco pasos, cada vez que pasa algo en tu tienda.",
    en: "The Loop is done when the opportunity moved forward, or when it landed with the right person. Five steps, every time something happens in your store.",
  },
  loop1Title: { es: "Detecta la señal", en: "It spots the signal" },
  loop1Body: {
    es: "Un mensaje, un comentario bajo un anuncio, un carrito abandonado, un pago rechazado, un pedido o una novedad de la entrega.",
    en: "A message, a comment under an ad, an abandoned cart, a declined payment, an order, or a delivery update.",
  },
  loop1P1: { es: "Siete canales y los comentarios", en: "Seven channels plus comments" },
  loop1P2: { es: "Eventos de tu tienda y de tus pagos", en: "Events from your store and payments" },
  loop1P3: { es: "También lo que pasa fuera de horario", en: "Including what happens after hours" },

  loop2Title: { es: "Entiende el contexto", en: "It reads the context" },
  loop2Body: {
    es: "Quién es la persona, qué producto miró, qué compró antes, qué hay disponible ahora y qué reglas pusiste tú.",
    en: "Who the person is, what they looked at, what they bought before, what's in stock now, and the rules you set.",
  },
  loop2P1: { es: "Catálogo, stock y precios en vivo", en: "Live catalog, stock, and prices" },
  loop2P2: { es: "Historial de compras y conversaciones", en: "Purchase and conversation history" },
  loop2P3: { es: "Tus políticas, escritas en tus palabras", en: "Your policies, in your own words" },

  loop3Title: { es: "Decide el siguiente paso", en: "It decides the next step" },
  loop3Body: {
    es: "Elige qué conviene hacer dentro de los límites que pusiste. Lo seguro lo ejecuta, lo sensible te lo pregunta y lo incierto te lo pasa.",
    en: "It picks what to do within the limits you set. It runs what's safe, asks about what's sensitive, and hands over what's uncertain.",
  },
  loop3P1: { es: "Cada herramienta: apagada, con permiso o sola", en: "Each tool: off, on approval, or automatic" },
  loop3P2: { es: "Nunca inventa un precio ni un plazo", en: "It never invents a price or a deadline" },
  loop3P3: { es: "Si no sabe, lo dice y escala", en: "If it doesn't know, it says so and escalates" },

  loop4Title: { es: "Ejecuta", en: "It executes" },
  loop4Body: {
    es: "Responde, recomienda, manda el link de pago, crea el pedido en tu tienda, hace el seguimiento o levanta el teléfono.",
    en: "It replies, recommends, sends the payment link, creates the order in your store, follows up, or picks up the phone.",
  },
  loop4P1: { es: "El pedido queda creado en tu tienda", en: "The order ends up created in your store" },
  loop4P2: { es: "Cobra por el medio que uses en tu país", en: "Charges through the method your country uses" },
  loop4P3: { es: "Y si hace falta, llama por teléfono", en: "And if needed, it calls on the phone" },

  loop5Title: { es: "Cierra el ciclo", en: "It closes the loop" },
  loop5Body: {
    es: "Registra qué pasó, qué resultado dio y qué información le faltó, para hacerlo mejor la próxima vez.",
    en: "It records what happened, what came of it, and what information was missing, to do it better next time.",
  },
  loop5P1: { es: "Cada venta queda atribuida", en: "Every sale is attributed" },
  loop5P2: { es: "Los huecos de conocimiento quedan anotados", en: "Knowledge gaps get written down" },
  loop5P3: { es: "Ves qué resolvió y qué escaló", en: "You see what it solved and what it escalated" },

  // ── Los pilares: el ángulo del chat ya pagado ──
  pillarsLabel: { es: "Por qué importa", en: "Why it matters" },
  pillarsTitle: {
    es: "Tu anuncio sí trajo al cliente",
    en: "Your ad did bring the customer",
  },
  pillarsLead: {
    es: "La venta se perdió después, cuando la conversación se enfrió. Entre el mensaje que nadie contestó, el carrito que quedó a medias y el pago que nunca se confirmó.",
    en: "The sale was lost afterwards, when the conversation went cold. Between the message nobody answered, the cart left halfway, and the payment never confirmed.",
  },
  pillar1Label: { es: "Recupera", en: "Recover" },
  pillar1: {
    es: "La intención que ya pagaste: comentarios, consultas, carritos y pagos pendientes reciben continuidad antes de enfriarse.",
    en: "The intent you already paid for: comments, questions, carts, and pending payments get followed through before they cool off.",
  },
  pillar2Label: { es: "Ejecuta", en: "Execute" },
  pillar2: {
    es: "Trabajo, no solamente respuestas. Consulta, recomienda, crea, cobra, informa, escala y deja registro de todo.",
    en: "Work, not just replies. It looks things up, recommends, creates, charges, reports, escalates, and logs all of it.",
  },
  pillar3Label: { es: "Delega", en: "Delegate" },
  pillar3: {
    es: "Sin quedarte ciega. Cada acción puede estar apagada, pedirte permiso o ejecutarse sola. Tú eliges cuál.",
    en: "Without going blind. Every action can be off, ask you first, or run on its own. You choose which.",
  },

  // ── Qué hace (la cuadrícula de fichas) ──
  capsLabel: { es: "Qué hace", en: "What it does" },
  capsTitle: {
    es: "Trece cosas que hace solo",
    en: "Thirteen things it does on its own",
  },
  capsBody: {
    es: "Cada una con los datos reales de tu tienda: tu stock, tus precios, tus pedidos.",
    en: "Each one with real data from your store: your stock, your prices, your orders.",
  },
  capsZeroLabel: { es: "líneas de código", en: "lines of code" },

  // Lo poco que las composiciones no pueden tomar del catálogo `landing`.
  compMes1: { es: "Marzo", en: "March" },
  compMes2: { es: "Junio", en: "June" },
  compHoy: { es: "Hoy", en: "Today" },
  compSincro: { es: "Stock · Precios · Pedidos", en: "Stock · Prices · Orders" },

  // ── Operator ──
  operatorLabel: { es: "Operator", en: "Operator" },
  operatorTitle: {
    es: "No lo configuras. Se lo pides.",
    en: "You don't configure it. You ask it.",
  },
  operatorBody: {
    es: "Escribes lo que necesitas como se lo dirías a un empleado. Riverz lo reparte entre catorce especialistas —uno de automatizaciones, otro de campañas, otro de productos— te muestra el reparto completo, y solo cuando lo apruebas se pone a trabajar.",
    en: "You write what you need the way you'd tell an employee. Riverz splits it across fourteen specialists — one for automations, one for campaigns, one for products — shows you the whole split, and only starts working once you approve it.",
  },
  operatorP1: {
    es: "Cada especialista solo puede tocar lo suyo",
    en: "Each specialist can only touch its own area",
  },
  operatorP2: {
    es: "Ves el reparto entero antes de que corra",
    en: "You see the whole split before it runs",
  },
  operatorP3: {
    es: "Lo que le llegue a un cliente te lo pregunta aparte",
    en: "Anything that reaches a customer gets asked separately",
  },

  opPrompt: {
    es: "Recupera los carritos de esta semana",
    en: "Recover this week's abandoned carts",
  },
  opPlanTitle: { es: "Plan de trabajo", en: "Work plan" },
  opApprove: { es: "Aprobar", en: "Approve" },
  opWorking: { es: "Trabajando…", en: "Working…" },
  opDone: { es: "Listo", en: "Done" },
  opNote: {
    es: "Lo que le llegue a un cliente te lo pregunta aparte.",
    en: "Anything that reaches a customer is asked separately.",
  },
  opTask1: { es: "Segmentar los carritos de 7 días", en: "Segment 7-day abandoned carts" },
  opTask2: { es: "Escribir el mensaje con el producto", en: "Write the message with the product" },
  opTask3: { es: "Prender el envío a las 3 horas", en: "Schedule the send for 3 hours later" },

  // ── La banda: un respiro entre la lista y los canales ──
  // Sale de los territorios creativos del documento. Es la frase más corta que
  // dice el mecanismo entero.
  bandaLine: {
    es: "De chat a pedido, sin perder el hilo.",
    en: "From chat to order, without losing the thread.",
  },

  // ── Canales ──
  channelsLabel: { es: "Canales", en: "Channels" },
  channelsTitle: {
    es: "Donde ya te escriben tus clientes",
    en: "Where your customers already write you",
  },
  channelsBody: {
    es: "Cada mensaje sale por las APIs oficiales, con los permisos aprobados. Nada de WhatsApp Web ni números clonados: tu cuenta no se bloquea.",
    en: "Every message goes out through the official APIs, with approved permissions. No WhatsApp Web, no cloned numbers: your account doesn't get blocked.",
  },
  channelsInboxes: { es: "Bandejas", en: "Inboxes" },
  channelsStores: { es: "Tiendas y logística", en: "Stores and logistics" },
  channelsCalls: { es: "Llamadas", en: "Calls" },

  // ── Cierre ──
  ctaTitle: {
    es: "Conecta tu tienda. El resto lo montamos nosotros.",
    en: "Connect your store. We'll build the rest.",
  },
  ctaBody: {
    es: "Estamos abriendo cupos de a poco. Déjanos tu correo y te escribimos para armar la operación contigo.",
    en: "We're opening spots gradually. Leave your email and we'll write to set the operation up with you.",
  },
} satisfies Namespace;
