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
  metaTitle: { es: "riverz", en: "riverz" },
  metaDescription: {
    es: "Toda tu operación comercial en un solo sistema agéntico. Riverz conecta tu tienda, tus canales y tus datos para coordinar agentes de IA que venden, recuperan compras y gestionan pedidos, recompras y postventa.",
    en: "Your entire commercial operation in one agentic system. Riverz connects your store, your channels, and your data to coordinate AI agents that sell, recover purchases, and handle orders, repeat sales, and post-purchase.",
  },

  // ── Barra de aviso: la oferta, que es lo más fuerte que tenemos ──
  bannerLead: { es: "Instalación gratis", en: "Free setup" },
  bannerText: {
    es: "la configuramos contigo y empiezas a pagar cuando ya esté dando resultados.",
    en: "we set it up with you, and you start paying once it's already delivering.",
  },
  bannerVer: { es: "Ver cómo", en: "See how" },
  cerrar: { es: "Cerrar", en: "Close" },

  // ── Navegación ──
  // El enlace dice lo mismo que la etiqueta de la sección a la que lleva: si
  // no coinciden, quien hace clic cree que aterrizó en otro lado.
  navLoop: { es: "Cómo trabaja", en: "How it works" },
  navCapabilities: { es: "Qué hace", en: "What it does" },
  navOperator: { es: "Operator", en: "Operator" },
  navChannels: { es: "Canales", en: "Channels" },
  navCta: { es: "Conectar mi tienda", en: "Connect my store" },
  skipToContent: { es: "Ir al contenido", en: "Skip to content" },

  // ── Hero ──
  // Titular y descripción escritos por el dueño. Dos cosas que hacen: nombran
  // el alcance («toda tu operación comercial», no un canal ni una bandeja) y
  // nombran la categoría con una palabra que todavía no está gastada
  // («sistema agéntico»), en vez de «chatbot» o «IA que responde», que es lo
  // que el documento manda evitar.
  heroTitleLead: { es: "Toda tu operación comercial.", en: "Your entire commercial operation." },
  heroTitleMuted: { es: "Un solo sistema agéntico.", en: "One agentic system." },
  heroSubtitle: {
    es: "Riverz conecta tu tienda, tus canales y tus datos para coordinar agentes de IA que venden, recuperan compras y gestionan pedidos, recompras y postventa.",
    en: "Riverz connects your store, your channels, and your data to coordinate AI agents that sell, recover purchases, and handle orders, repeat sales, and post-purchase.",
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
  // «Riverz Loop» era un nombre interno. Nadie que entra por primera vez sabe
  // qué es un loop, y una portada no es el lugar para enseñar vocabulario
  // propio: la etiqueta dice qué vas a leer y el titular hace el argumento.
  loopLabel: { es: "Cómo trabaja", en: "How it works" },
  loopTitle: {
    es: "Un chatbot termina cuando responde",
    en: "A chatbot is done when it replies",
  },
  loopLead: {
    es: "Riverz recién termina cuando la venta avanzó, o cuando la conversación quedó en manos de la persona correcta. Estos cinco pasos ocurren cada vez que algo pasa en tu tienda.",
    en: "Riverz isn't done until the sale moved forward, or the conversation landed with the right person. These five steps run every time something happens in your store.",
  },
  // Cinco pasos, del lado del comercio. Sin «señal», sin «contexto», sin
  // «ejecuta»: nadie que vende por WhatsApp piensa con esas palabras.
  loop1Title: { es: "Se entera", en: "It notices" },
  loop1Body: {
    es: "Un mensaje, un comentario en un anuncio, un carrito que quedó a medias, un pago que se cayó. Lo ve todo, también de madrugada.",
    en: "A message, a comment on an ad, a cart left half-finished, a payment that bounced. It catches all of it, at 3 a.m. too.",
  },
  loop1P1: { es: "Siete canales y los comentarios", en: "Seven channels plus comments" },
  loop1P2: { es: "Y lo que pasa en tu tienda y tus pagos", en: "Plus what happens in your store and payments" },

  loop2Title: { es: "Sabe con quién habla", en: "It knows who it's talking to" },
  loop2Body: {
    es: "Antes de escribir ya sabe qué compró esa persona, qué estuvo mirando y qué hay en stock ahora mismo. No adivina: lee tu tienda.",
    en: "Before it types, it already knows what that person bought, what they were looking at, and what's in stock right now. It doesn't guess — it reads your store.",
  },
  loop2P1: { es: "Catálogo, stock y precios en vivo", en: "Live catalog, stock, and prices" },
  loop2P2: { es: "Historial de compras y conversaciones", en: "Purchase and conversation history" },

  loop3Title: { es: "Decide hasta dónde llega", en: "It decides how far to go" },
  loop3Body: {
    es: "Tú marcas los límites. Lo seguro lo hace solo, lo delicado te lo pregunta, y lo que no sabe te lo pasa a ti.",
    en: "You set the limits. It handles what's safe on its own, asks you about anything delicate, and hands you what it doesn't know.",
  },
  loop3P1: { es: "Cada herramienta: apagada, con permiso o sola", en: "Each tool: off, ask first, or automatic" },
  loop3P2: { es: "Nunca inventa un precio ni un plazo", en: "It never invents a price or a deadline" },

  // El cuarto es el argumento entero. Si alguien lee un solo paso, que sea este.
  loop4Title: { es: "Cierra la venta, no solo la charla", en: "It closes the sale, not just the chat" },
  loop4Body: {
    es: "Acá deja de parecerse a un chatbot: crea el pedido en tu tienda, cobra y hace el seguimiento del envío. Y si hace falta, llama por teléfono.",
    en: "This is where it stops resembling a chatbot: it creates the order in your store, takes the payment, and follows the shipment. And if it takes a call, it calls.",
  },
  loop4P1: { es: "El pedido queda creado en tu tienda", en: "The order ends up created in your store" },
  loop4P2: { es: "Cobra por el medio que uses en tu país", en: "Charges through the method your country uses" },

  loop5Title: { es: "Te muestra qué ganaste", en: "It shows you what you earned" },
  loop5Body: {
    es: "Cada venta queda atribuida, así ves cuánto te devolvió de verdad. Y lo que no supo responder queda anotado para que la próxima sí.",
    en: "Every sale is attributed, so you see what it actually returned. And whatever it couldn't answer gets written down, so next time it can.",
  },
  loop5P1: { es: "Cada venta queda atribuida", en: "Every sale is attributed" },
  loop5P2: { es: "Ves qué resolvió y qué te pasó a ti", en: "You see what it solved and what it handed you" },

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

  // Vendedor: la gracia es que la respuesta CITA el dato de la ficha.
  compAsk: { es: "¿Les queda en talla 38?", en: "Do you have it in size 38?" },
  compAnswer: {
    es: "Sí, quedan 4 en talla 38. Te la aparto.",
    en: "Yes, 4 left in size 38. I'll hold one for you.",
  },
  compStock: { es: "Talla 38 · 4 en stock", en: "Size 38 · 4 in stock" },
  compCatalog: { es: "Tu catálogo", en: "Your catalog" },

  // Atención: la hora es el argumento entero.
  compOrder: { es: "Pedido", en: "Order" },
  compConfirmed: { es: "Confirmado", en: "Confirmed" },
  compShipped: { es: "En camino", en: "On its way" },
  compTracking: { es: "Guía 889-2231", en: "Tracking 889-2231" },
  compHour: { es: "3:14 a. m.", en: "3:14 AM" },

  // Comentarios: el comentario público y el DM que sigue.
  compComment: { es: "precio?", en: "how much?" },
  compPublicReply: {
    es: "¡Te escribimos por DM! 💛",
    en: "Just sent you a DM! 💛",
  },
  compDm: {
    es: "$239.000 y tenemos envío gratis hoy.",
    en: "$239,000 and shipping is free today.",
  },

  // Bandeja: los cinco canales y la fila que llega.
  compOneInbox: { es: "Una bandeja", en: "One inbox" },
  compUnread: { es: "3 sin responder", en: "3 unanswered" },

  // En vivo: lo que se ve desde el teléfono.
  compLiveNow: { es: "En vivo", en: "Live" },
  compTakeOver: { es: "Entrar a la conversación", en: "Join the conversation" },

  // Contactos: la ficha que se llena sola y el segmento que sale de ella.
  compCity: { es: "Bogotá", en: "Bogotá" },
  compSpent: { es: "$1.240.000 gastados", en: "$1,240,000 spent" },
  compOrders: { es: "3 pedidos", en: "3 orders" },
  compSegment: { es: "Compradores frecuentes · 412", en: "Frequent buyers · 412" },

  // Puesta en marcha: tres pasos y ya.
  compStep1: { es: "Conecta la tienda", en: "Connect your store" },
  compStep2: { es: "Conecta WhatsApp", en: "Connect WhatsApp" },
  compStep3: { es: "Enciende el agente", en: "Turn the agent on" },
  compMinutes: { es: "8 minutos", en: "8 minutes" },

  // ROAS: la cifra y de dónde sale.
  compRoas: { es: "ROAS", en: "ROAS" },
  compAttributed: { es: "Atribuido al agente", en: "Attributed to the agent" },
  compInvested: { es: "Invertido", en: "Spent" },
  compReturned: { es: "Devuelto", en: "Returned" },

  // ── Operator ──
  operatorLabel: { es: "Operator", en: "Operator" },
  // Este bloque va a todo el ancho y con la mínima cantidad de texto posible:
  // la animación tiene que contar la función sola. Un titular, una línea y el
  // chat. Lo que antes eran tres viñetas ahora lo dice el propio reparto.
  operatorTitle: {
    es: "No lo configuras. Se lo pides.",
    en: "You don't configure it. You ask it.",
  },
  operatorLead: {
    es: "Le hablas como a un empleado. Catorce especialistas se reparten el trabajo y tú apruebas.",
    en: "You talk to it like you'd talk to an employee. Fourteen specialists split the work, and you approve.",
  },

  // Lo que se escribe y lo que contesta, dentro de la animación.
  opPrompt: {
    es: "Recupera los carritos de esta semana",
    en: "Recover this week's abandoned carts",
  },
  opLine1: { es: "Segmenté 1.284 carritos de 7 días", en: "Segmented 1,284 carts from the last 7 days" },
  opLine2: { es: "Escribí el mensaje con el producto", en: "Wrote the message with the product" },
  opLine3: { es: "Programé el envío a las 3 horas", en: "Scheduled the send for 3 hours later" },
  opAsk: { es: "¿Lo activo?", en: "Shall I turn it on?" },
  opApprove: { es: "Aprobar", en: "Approve" },
  opNote: {
    es: "Nada le llega a un cliente sin que lo apruebes.",
    en: "Nothing reaches a customer without your approval.",
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

  // ── Confianza ──
  // Todo lo de acá es verificable. No decimos «Meta Business Partner»: ese es
  // un programa cerrado con su propio directorio y su propia insignia, y usar
  // el sello sin estar adentro va contra las normas de marca de Meta y pone en
  // riesgo la app. Lo que sí es cierto —y es lo que de verdad tranquiliza— es
  // que la conexión es por la API oficial y que el App Review está aprobado.
  trustLabel: { es: "Confianza", en: "Trust" },
  trustTitle: {
    es: "Conectado por la puerta de adelante",
    en: "Connected through the front door",
  },
  trustBody: {
    es: "Muchas herramientas se cuelgan de un teléfono espejo o de una sesión no oficial, y el día que la plataforma lo detecta el número se cae. Riverz no hace eso.",
    en: "Plenty of tools hang off a mirrored phone or an unofficial session, and the day the platform notices, the number goes down. Riverz doesn't do that.",
  },
  trust1Title: { es: "API oficial de Meta", en: "Official Meta APIs" },
  trust1Body: {
    es: "WhatsApp Business Platform, Instagram y Messenger por sus canales oficiales. Tu número queda a tu nombre y no se expone a un bloqueo.",
    en: "WhatsApp Business Platform, Instagram and Messenger through their official channels. Your number stays yours and isn't exposed to a ban.",
  },
  trust2Title: { es: "Revisada por Meta", en: "Reviewed by Meta" },
  trust2Body: {
    es: "La aplicación pasó el App Review de Meta con todos los permisos que usa en acceso avanzado, incluidos mensajes y comentarios.",
    en: "The app passed Meta's App Review with every permission it uses at advanced access, messaging and comments included.",
  },
  trust3Title: { es: "Nada sale sin permiso", en: "Nothing goes out unapproved" },
  trust3Body: {
    es: "Cada herramienta del agente se prende, se pide aprobación o se apaga. Cancelar un pedido o devolver plata nunca queda en automático.",
    en: "Every agent tool is on, ask-first, or off. Cancelling an order or refunding money is never left on automatic.",
  },
  trust4Title: { es: "Tus datos, tuyos", en: "Your data stays yours" },
  trust4Body: {
    es: "Cifrado en tránsito y en reposo, cada comercio aislado del resto, y exportas o borras todo cuando quieras.",
    en: "Encrypted in transit and at rest, every store isolated from the rest, and you can export or delete everything whenever you want.",
  },

  // ── Cierre ──
  // Sin promesa de instalación: eso vive en la oferta, que es temporal.
  ctaTitle: {
    es: "Conecta tu tienda y empieza a operar.",
    en: "Connect your store and start operating.",
  },
  ctaBody: {
    es: "Estamos abriendo cupos de a poco. Déjanos tu correo y te escribimos para armar la operación contigo.",
    en: "We're opening spots gradually. Leave your email and we'll write to set the operation up with you.",
  },
} satisfies Namespace;
