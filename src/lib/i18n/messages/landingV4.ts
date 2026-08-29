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
  navLoop: { es: "La diferencia", en: "The difference" },
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
    es: "Otras herramientas te dan un panel vacío. Riverz llega montado: conectas la tienda y nosotros hacemos el resto.",
    en: "Other tools hand you an empty dashboard. Riverz arrives built: you connect the store, we do the rest.",
  },
  // Su propio botón, distinto al de la barra. El de arriba dice qué hacés;
  // éste dice qué te llevás, que es de lo que trata el diálogo.
  launchCta: { es: "Que lo monten por mí", en: "Set it up for me" },
  launch1Title: { es: "Conectas tu tienda", en: "You connect your store" },
  launch1Body: { es: "Unos clics. No hay nada que diseñar.", en: "A few clicks. Nothing to design." },
  launch2Title: { es: "Riverz estudia tu marca", en: "Riverz studies your brand" },
  launch2Body: { es: "Catálogo, políticas, tono y pedidos.", en: "Catalog, policies, tone and orders." },
  launch3Title: { es: "Lo configuramos nosotros", en: "We configure it" },
  launch3Body: { es: "Agentes, flujos, seguimientos y límites.", en: "Agents, flows, follow-ups and limits." },
  launch4Title: { es: "Tú apruebas", en: "You approve" },
  launch4Body: { es: "No le escribe a nadie hasta que digas que sí.", en: "It writes to nobody until you say yes." },
  launch5Title: { es: "Pagas después", en: "You pay later" },
  launch5Body: { es: "La instalación no cuesta. El plan arranca cuando ya funciona.", en: "Setup is free. The plan starts once it works." },

  // ── Riverz Loop: el mecanismo ──
  // «Riverz Loop» era un nombre interno. Nadie que entra por primera vez sabe
  // qué es un loop, y una portada no es el lugar para enseñar vocabulario
  // propio: la etiqueta dice qué vas a leer y el titular hace el argumento.
  // El titular decía «Un chatbot termina cuando responde»: una adivinanza que
  // obligaba a leer la bajada para entenderla, y la bajada tampoco cerraba
  // («la venta avanzó» no es nada que se pueda ver). Ahora el titular es la
  // comparación directa y la bajada la prueba con lo único que se nota: quién
  // carga el pedido.
  loopLabel: { es: "La diferencia", en: "The difference" },
  loopTitle: {
    es: "Las demás plataformas contestan. Riverz vende.",
    en: "Other platforms reply. Riverz sells.",
  },
  loopLead: {
    es: "Un chatbot contesta la pregunta y ahí se acaba. Riverz sigue: recomienda, va a buscar el carrito que quedó a medias, confirma la compra y avisa dónde viene el pedido.",
    en: "A chatbot answers the question and that's where it ends. Riverz keeps going: it recommends, chases the cart left halfway, confirms the purchase, and tells them where the order is.",
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
    es: "Acá deja de parecerse a un chatbot: manda el link para pagar, confirma la compra y sigue el envío hasta la puerta. Y si hace falta, llama por teléfono.",
    en: "This is where it stops resembling a chatbot: it sends the link to pay, confirms the purchase, and follows the shipment to the door. And if a call is what it takes, it calls.",
  },
  loop4P1: { es: "La venta se cierra en el chat", en: "The sale closes inside the chat" },
  loop4P2: { es: "Cobra por el medio que uses en tu país", en: "Charges through the method your country uses" },

  loop5Title: { es: "Te muestra qué ganaste", en: "It shows you what you earned" },
  loop5Body: {
    es: "Cada venta queda atribuida, así ves cuánto te devolvió de verdad. Y lo que no supo responder queda anotado para que la próxima sí.",
    en: "Every sale is attributed, so you see what it actually returned. And whatever it couldn't answer gets written down, so next time it can.",
  },
  loop5P1: { es: "Cada venta queda atribuida", en: "Every sale is attributed" },
  loop5P2: { es: "Ves qué resolvió y qué te pasó a ti", en: "You see what it solved and what it handed you" },

  // ── Los pilares: el ángulo del chat ya pagado ──
  // Esta sección es el PROBLEMA, y es lo único que dice que no diga otra.
  // Tenía además tres pilares —Recupera, Ejecuta, Delega— que repetían, uno por
  // uno, el titular de acá mismo, el de «La diferencia» y una viñeta del paso
  // 03. Se fueron los tres: en un teléfono eran media pantalla de texto ya
  // leído.
  pillarsLabel: { es: "Por qué importa", en: "Why it matters" },
  pillarsTitle: {
    es: "Menos caos, más facturación",
    en: "Less chaos, more revenue",
  },
  pillarsLead: {
    es: "Tu anuncio sí trajo al cliente. La venta se perdió después, cuando nadie contestó a tiempo y la conversación se enfrió.",
    en: "Your ad did bring the customer. The sale was lost afterwards, when nobody answered in time and the conversation went cold.",
  },

  // ── Qué hace (la cuadrícula de fichas) ──
  capsLabel: { es: "Qué hace", en: "What it does" },
  capsTitle: {
    es: "Trece cosas que hace solo",
    en: "Thirteen things it does on its own",
  },
  capsBody: {
    es: "Desde la primera pregunta hasta la recompra.",
    en: "From the first question to the repeat purchase.",
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
    es: "Siete bandejas, los comentarios de tus anuncios y las llamadas, en una sola pantalla. Y del otro lado, tu tienda y tus pagos.",
    en: "Seven inboxes, the comments on your ads, and the calls — on one screen. And on the other side, your store and your payments.",
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
  // Una frase y una descripción. Nada más.
  //
  // Acá hubo primero cuatro bloques de título + párrafo (noventa palabras) y
  // después cinco insignias de texto. Las dos versiones explicaban; ninguna
  // tranquilizaba. Quien lee esto no quiere el detalle técnico de cómo nos
  // conectamos: quiere saber que no se le va a caer nada encima. Eso se dice
  // en una línea y se prueba con un sello, no con una lista.
  trustTitle: {
    es: "Tu número está a salvo",
    en: "Your number is safe",
  },
  trustBody: {
    es: "Riverz conecta tus canales por la vía oficial de Meta, con todos los permisos aprobados. Tu número queda a tu nombre y tus datos son sólo tuyos.",
    en: "Riverz connects your channels the official Meta way, with every permission approved. Your number stays in your name and your data stays yours.",
  },
  trustPill: {
    es: "Nada se cae. Nada se pierde.",
    en: "Nothing goes down. Nothing gets lost.",
  },
  // Las dos vueltas del sello.
  trustSealTop: { es: "Conexión oficial", en: "Official connection" },
  trustSealRing: {
    es: "API OFICIAL DE META · APP REVIEW APROBADO",
    en: "OFFICIAL META API · APP REVIEW APPROVED",
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
