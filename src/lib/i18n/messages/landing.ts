import type { Namespace } from "./types";

/** Public marketing landing (riverz.co logged-out root): metadata, hero,
 *  feature sections, interactive previews, waitlist form, CTA, footer. */
export const landing = {
  // ── Page metadata (browser tab, search snippets, share previews) ──
  metaTitle: {
    es: "riverz",
    en: "riverz",
  },
  metaDescription: {
    es: "Agentes de IA que atienden, deciden y ejecutan en WhatsApp, Instagram, Messenger, Mercado Libre, correo y llamadas: recomiendan, recuperan carritos y crean el pedido en tu tienda. 24/7, sin que tengas que responder.",
    en: "AI agents that engage, decide, and act on WhatsApp, Instagram, Messenger, Mercado Libre, email, and calls: they recommend, recover carts, and create the order in your store. 24/7, without you replying.",
  },
  ogTitle: {
    es: "Agentes de IA que cierran la venta · riverz",
    en: "AI agents that close the sale · riverz",
  },
  ogDescription: {
    es: "Atienden, deciden y ejecutan en WhatsApp, Instagram, Messenger, Mercado Libre, correo y llamadas: recomiendan, recuperan carritos y crean el pedido.",
    en: "They engage, decide, and act on WhatsApp, Instagram, Messenger, Mercado Libre, email, and calls: they recommend, recover carts, and create the order.",
  },

  // ── Header / nav ──
  navWaitlist: { es: "Lista de espera", en: "Join waitlist" },

  // ── Hero ──
  heroTitleLead: { es: "Contesta tus chats", en: "It answers your chats" },
  heroTitleMuted: { es: "y cierra tus ventas.", en: "and closes your sales." },
  heroSubtitle: {
    es: "Riverz reúne WhatsApp, Instagram, Messenger, Mercado Libre, correo y llamadas en una sola bandeja, y un agente de IA responde, recomienda y crea el pedido en tu tienda.",
    en: "Riverz brings WhatsApp, Instagram, Messenger, Mercado Libre, email, and calls into one inbox, and an AI agent replies, recommends, and creates the order in your store.",
  },
  heroCta: {
    es: "Unirse a la lista de espera",
    en: "Join the waitlist",
  },

  // ── Channels / integrations strip ──
  channelEmail: { es: "Correo", en: "Email" },
  channelCalls: { es: "Llamadas", en: "Calls" },
  stripChannels: { es: "Canales", en: "Channels" },
  stripIntegrations: { es: "Integraciones", en: "Integrations" },

  // ── Waitlist form ──
  waitlistDone: {
    es: "¡Listo! Te avisamos apenas abramos cupos.",
    en: "You're in! We'll reach out the moment spots open.",
  },
  emailPlaceholder: { es: "tu@correo.com", en: "you@email.com" },
  emailAriaLabel: { es: "Correo electrónico", en: "Email address" },
  waitlistSending: { es: "Enviando…", en: "Sending…" },
  waitlistSubmit: {
    es: "Unirse a la lista de espera",
    en: "Join the waitlist",
  },
  waitlistError: {
    es: "Hubo un problema. Intenta de nuevo.",
    en: "Something went wrong. Please try again.",
  },

  // ── Feature sections (titles + body copy; `eyebrow`/`n`/`icon` in the
  //    SECTIONS data are not rendered, so they have no keys) ──
  sec01Title: { es: "Responde preguntas sobre", en: "It answers questions about" },
  sec01TitleMuted: {
    es: "productos, precios y envíos.",
    en: "products, prices, and shipping.",
  },
  sec01Body: {
    es: "El agente lee tu catálogo y contesta con el stock y los precios que tienes hoy. Recomienda productos, sugiere lo que combina y cierra la compra.",
    en: "The agent reads your catalog and answers with the stock and prices you have today. It recommends products, suggests what pairs well, and closes the sale.",
  },

  sec02Title: { es: "Le escribe al que dejó", en: "It messages whoever left" },
  sec02TitleMuted: {
    es: "el carrito a medias.",
    en: "a cart behind.",
  },
  sec02Body: {
    es: "Detecta el carrito abandonado, manda un mensaje con el producto y el link de pago, y responde las dudas que aparezcan hasta cerrar la venta.",
    en: "It detects the abandoned cart, sends a message with the product and the payment link, and answers whatever questions come up until the sale closes.",
  },

  sec03Title: {
    es: "Vuelve a escribirle",
    en: "It follows up with",
  },
  sec03TitleMuted: {
    es: "a quien ya te compró.",
    en: "anyone who already bought.",
  },
  sec03Body: {
    es: "Programas la recompra según los días desde el último pedido y el agente la envía sola, con la oferta que corresponde a cada cliente.",
    en: "You set the repeat-purchase timing based on days since the last order, and the agent sends it on its own, with the offer that fits each customer.",
  },

  sec04Title: { es: "Confirma pedidos y manda", en: "It confirms orders and sends" },
  sec04TitleMuted: { es: "el número de guía.", en: "the tracking number." },
  sec04Body: {
    es: "Avisa cuando el pedido sale, envía el seguimiento y responde “¿cuándo llega?” con el estado real del envío, a cualquier hora.",
    en: "It notifies when the order ships, sends the tracking, and answers “when does it arrive?” with the real shipping status, at any hour.",
  },

  // En vivo / móvil — mirar al agente trabajar y entrar cuando quieras.
  secLiveTitle: { es: "Muestra cada respuesta", en: "It shows every reply" },
  secLiveTitleMuted: { es: "en tiempo real.", en: "in real time." },
  secLiveBody: {
    es: "Ves la conversación mientras ocurre, desde el computador o el celular, y tomas el control con un toque cuando quieras responder tú.",
    en: "You watch the conversation as it happens, from your desktop or your phone, and take over with one tap whenever you want to reply yourself.",
  },

  // Voz — sección propia: el agente también habla por teléfono.
  secVoiceTitle: { es: "Llama por teléfono", en: "It calls on the phone" },
  secVoiceTitleMuted: {
    es: "y habla con el cliente.",
    en: "and talks to the customer.",
  },
  secVoiceBody: {
    es: "Marca para confirmar pedidos contraentrega, recuperar carritos y hacer seguimiento, y contesta las llamadas que entran. Cada llamada queda transcrita y con su resultado.",
    en: "It dials to confirm cash-on-delivery orders, recover carts, and follow up, and it answers incoming calls. Every call is transcribed and closed with an outcome.",
  },

  // Contactos y segmentos — la base de clientes que se ordena sola.
  secContactsTitle: { es: "Guarda qué compró cada cliente,", en: "It records what each customer bought," },
  secContactsTitleMuted: { es: "cuánto gastó y dónde vive.", en: "how much they spent, and where they live." },
  secContactsBody: {
    es: "La ficha se completa sola con cada conversación y cada pedido. Filtras por gasto, pedidos, ciudad o etiqueta, y guardas el filtro como segmento.",
    en: "The contact fills itself in with every conversation and every order. You filter by spend, orders, city, or tag, and save the filter as a segment.",
  },

  sec05Title: { es: "Responde los comentarios", en: "It replies to comments" },
  sec05TitleMuted: { es: "de Instagram y Facebook.", en: "on Instagram and Facebook." },
  sec05Body: {
    es: "Contesta cada comentario en publicaciones y anuncios, y le manda un mensaje privado a quien preguntó para seguir la venta por DM.",
    en: "It answers every comment on posts and ads, and sends a private message to whoever asked so the sale continues in DMs.",
  },

  sec06Title: { es: "Envía campañas masivas", en: "It sends bulk campaigns" },
  sec06TitleMuted: {
    es: "por WhatsApp e Instagram.",
    en: "on WhatsApp and Instagram.",
  },
  sec06Body: {
    es: "Eliges un segmento, escribes el mensaje y sale a miles de contactos. Ves entregados, leídos, respuestas y ventas en vivo, y el agente atiende a quien conteste.",
    en: "You pick a segment, write the message, and it goes out to thousands of contacts. You see delivered, read, replies, and sales live, and the agent handles anyone who answers.",
  },

  sec07Title: { es: "Reúne seis canales", en: "It brings six channels" },
  sec07TitleMuted: { es: "en una sola bandeja.", en: "into one inbox." },
  sec07Body: {
    es: "WhatsApp, Instagram, Messenger, Mercado Libre, correo y llamadas en la misma pantalla, con el historial completo de cada cliente. Tu equipo y el agente trabajan sobre la misma conversación.",
    en: "WhatsApp, Instagram, Messenger, Mercado Libre, email, and calls on the same screen, with each customer's full history. Your team and the agent work on the same conversation.",
  },

  sec08Title: { es: "Sincroniza tu tienda:", en: "It syncs your store:" },
  sec08TitleMuted: {
    es: "stock, precios y pedidos.",
    en: "stock, prices, and orders.",
  },
  sec08Body: {
    es: "Se conecta con Shopify, WooCommerce, Tiendanube y Mercado Libre. El agente vende con el inventario al día y deja el pedido creado en tu tienda.",
    en: "It connects to Shopify, WooCommerce, Tiendanube, and Mercado Libre. The agent sells with up-to-date inventory and leaves the order created in your store.",
  },

  sec09Title: { es: "Se configura solo", en: "It sets itself up" },
  sec09TitleMuted: {
    es: "con tu catálogo.",
    en: "from your catalog.",
  },
  sec09Body: {
    es: "Conectas la tienda y los canales, Riverz investiga tu marca y entrena al agente con tus productos. Lo revisas y lo enciendes. Sin código.",
    en: "You connect your store and channels, Riverz researches your brand and trains the agent on your products. You review it and switch it on. No code.",
  },

  sec10Title: { es: "Muestra cuánto vendió", en: "It shows how much" },
  sec10TitleMuted: { es: "el agente, en pesos.", en: "the agent sold, in money." },
  sec10Body: {
    es: "Cada venta queda atribuida: ingresos, carritos recuperados y tiempo de respuesta, por día y por canal.",
    en: "Every sale is attributed: revenue, recovered carts, and response time, by day and by channel.",
  },

  // ── Hero inbox preview ──
  heroAgentStatus: {
    es: "atiende la IA · responde en 4s",
    en: "handled by AI · replies in 4s",
  },
  agentActive: { es: "Agente activo", en: "Agent active" },
  saleConfirmed: { es: "Venta confirmada", en: "Sale confirmed" },
  saleUnit: { es: "1 ud.", en: "1 unit" },
  saleOrder: { es: "Pedido {order}", en: "Order {order}" },

  // Hero conversation 1 (WhatsApp · Laura)
  hero1Them1: {
    es: "Hola 👋 ¿los Tenis Aura vienen en talla 39?",
    en: "Hi 👋 do the Aura Sneakers come in size 39?",
  },
  hero1You1: {
    es: "¡Hola Laura! Sí 🙌 quedan 6 pares en talla 39.",
    en: "Hi Laura! Yes 🙌 we have 6 pairs left in size 39.",
  },
  hero1You2: {
    es: "Hoy con 15% off y envío gratis. ¿Te los aparto?",
    en: "Today they're 15% off with free shipping. Want me to hold them for you?",
  },
  hero1Them2: { es: "Sí, los quiero 💛", en: "Yes, I want them 💛" },
  hero1You3: {
    es: "Listo, te dejo el pago seguro aquí 👇",
    en: "Done, here's your secure checkout 👇",
  },

  // Hero conversation 2 (Instagram · andres.q)
  hero2Them1: {
    es: "vi el Perfume Solé en tu historia, ¿aún hay? 👀",
    en: "saw the Solé Perfume in your story, still in stock? 👀",
  },
  hero2You1: {
    es: "¡Hola Andrés! Sí, quedan pocas unidades 🙌",
    en: "Hi Andrés! Yes, only a few units left 🙌",
  },
  hero2You2: {
    es: "Te incluyo muestra de regalo. ¿Lo pedimos?",
    en: "I'll throw in a free sample. Shall we place the order?",
  },
  hero2Them2: { es: "dale, lo quiero 🔥", en: "go for it, I want it 🔥" },
  hero2You3: {
    es: "Perfecto, aquí tu link de pago 👇",
    en: "Perfect, here's your payment link 👇",
  },

  // Hero conversation 3 (Messenger · Sofía)
  hero3Them1: {
    es: "¿La Mochila Drift es resistente al agua?",
    en: "Is the Drift Backpack water-resistant?",
  },
  hero3You1: {
    es: "¡Hola Sofía! Sí, es impermeable y trae garantía 🙌",
    en: "Hi Sofía! Yes, it's waterproof and comes with a warranty 🙌",
  },
  hero3You2: {
    es: "Hoy con envío gratis. ¿Te la despacho?",
    en: "Free shipping today. Want me to ship it out?",
  },
  hero3Them2: { es: "Sí porfa 🙌", en: "Yes please 🙌" },
  hero3You3: {
    es: "Listo, te paso el pago seguro 👇",
    en: "Done, here's your secure checkout 👇",
  },

  // Hero conversation 4 (Email · Camilo)
  hero4Them1: {
    es: "¿El Reloj Nórdico tiene cuotas sin interés?",
    en: "Does the Nordic Watch offer interest-free installments?",
  },
  hero4You1: {
    es: "¡Hola Camilo! Sí, hasta 3 cuotas sin interés ✉️",
    en: "Hi Camilo! Yes, up to 3 interest-free installments ✉️",
  },
  hero4You2: {
    es: "¿Quieres que te genere el pedido?",
    en: "Want me to create the order for you?",
  },
  hero4Them2: { es: "Sí, gracias", en: "Yes, thanks" },
  hero4You3: {
    es: "Listo, aquí tu pago seguro 👇",
    en: "Done, here's your secure checkout 👇",
  },

  // Hero conversation 5 (Mercado Libre · CAROL2345) — en ML la compra se
  // termina dentro de la publicación, así que el agente no manda link de pago.
  hero5Them1: {
    es: "¿El Parlante Onda llega mañana?",
    en: "Will the Onda Speaker arrive tomorrow?",
  },
  hero5You1: {
    es: "¡Hola! Sí, con envío full llega mañana 🚚",
    en: "Hi! Yes, with full shipping it arrives tomorrow 🚚",
  },
  hero5You2: {
    es: "Quedan 4 unidades y hoy está con descuento.",
    en: "4 units left and it's discounted today.",
  },
  hero5Them2: { es: "Genial, lo compro", en: "Great, I'll buy it" },
  hero5You3: {
    es: "Listo, ya puedes finalizar la compra 👇",
    en: "Done, you can complete the purchase 👇",
  },

  // Hero product names
  prodSneakers: { es: "Tenis Aura", en: "Aura Sneakers" },
  prodSpeaker: { es: "Parlante Onda", en: "Onda Speaker" },
  prodPerfume: { es: "Perfume Solé", en: "Solé Perfume" },
  prodBackpack: { es: "Mochila Drift", en: "Drift Backpack" },
  prodWatch: { es: "Reloj Nórdico", en: "Nordic Watch" },

  // ── Inbox preview rows ──
  inboxNoteReplied: {
    es: "Respondido por la IA en 4s",
    en: "Replied by AI in 4s",
  },
  inboxNoteComment: {
    es: "Comentario respondido y llevado al DM",
    en: "Comment answered and moved to DMs",
  },
  inboxWaThem: { es: "¿Hacen envíos a Cali?", en: "Do you ship to Cali?" },
  inboxWaYou: { es: "Sí, llega en 2 días 📦", en: "Yes, it arrives in 2 days 📦" },
  inboxIgThem: { es: "Me encantó mi compra 💛", en: "I loved my purchase 💛" },
  inboxIgYou: {
    es: "¡Gracias! Te paso el link 👇",
    en: "Thank you! Here's the link 👇",
  },
  inboxMsgThem: { es: "¿Sigue disponible?", en: "Is it still available?" },
  inboxMsgYou: { es: "Sí, quedan pocas 🙌", en: "Yes, only a few left 🙌" },
  inboxMailName: { es: "Pedido #1042", en: "Order #1042" },
  inboxMailThem: { es: "¿Estado de mi pedido?", en: "What's my order status?" },
  inboxMailYou: {
    es: "Va en camino, llega mañana ✉️",
    en: "On its way, arriving tomorrow ✉️",
  },
  inboxMlThem: {
    es: "¿Cuánto demora el envío?",
    en: "How long does shipping take?",
  },
  inboxMlYou: { es: "Llega en 24 h con full 🚚", en: "Arrives in 24h with full 🚚" },
  inboxCommentLabel: { es: "Comentarios", en: "Comments" },
  inboxCommentName: {
    es: "Comentario · Instagram",
    en: "Comment · Instagram",
  },
  inboxCommentThem: { es: "¿Cuánto vale? 😍", en: "How much is it? 😍" },
  inboxCommentYou: {
    es: "¡Te escribí por DM! 💛",
    en: "I DM'd you! 💛",
  },

  // ── Agent panel preview ──
  agentSourceCatalog: { es: "Catálogo", en: "Catalog" },
  agentSourcePrices: { es: "Precios", en: "Prices" },
  agentSourceShipping: { es: "Envíos", en: "Shipping" },
  agentSourceReviews: { es: "Reseñas", en: "Reviews" },
  agentTraining: { es: "Entrenándose", en: "Training" },
  agentReady: { es: "Agente listo", en: "Agent ready" },

  // ── Cart recovery preview ──
  cartCustomer: { es: "Mariana L.", en: "Mariana L." },
  cartStatusRecovered: { es: "Recuperado", en: "Recovered" },
  cartStatusAbandoned: { es: "Abandonado", en: "Abandoned" },
  cartProduct: { es: "Audífonos Pulse", en: "Pulse Headphones" },
  cartSaleRecovered: { es: "Venta recuperada", en: "Sale recovered" },

  // ── Comments preview ──
  commentsBrand: { es: "tu.marca", en: "your.brand" },
  commentsAd: { es: "Anuncio", en: "Ad" },
  commentRepliedDm: {
    es: "Respondido por la IA · al DM",
    en: "Replied by AI · to DMs",
  },
  comment1: { es: "¿Cuánto vale? 😍", en: "How much is it? 😍" },
  comment2: {
    es: "¿Hacen envíos a todo el país?",
    en: "Do you ship nationwide?",
  },
  comment3: { es: "Lo quiero en negro 🔥", en: "I want it in black 🔥" },

  // ── Support preview ──
  support247: { es: "Soporte 24/7", en: "24/7 support" },
  supportOnline: { es: "en línea", en: "online" },
  supportOrderConfirmed: { es: "Pedido confirmado", en: "Order confirmed" },
  supportOnTheWay: {
    es: "En camino · guía enviada",
    en: "On the way · tracking sent",
  },
  supportQuestionResolved: {
    es: "“¿Cuándo llega?” resuelto",
    en: "“When will it arrive?” resolved",
  },
  supportNow: { es: "ahora", en: "now" },

  // ── Setup preview ──
  setupTitle: { es: "Configura tu agente", en: "Set up your agent" },
  setupSteps: { es: "3 pasos · ~2 minutos", en: "3 steps · ~2 minutes" },
  setupConnectChannels: { es: "Conecta tus canales", en: "Connect your channels" },
  setupConnectStore: { es: "Conecta tu tienda", en: "Connect your store" },
  setupActivateAgent: { es: "Activa el agente", en: "Turn on the agent" },
  setupActive: { es: "Activo", en: "Active" },
  setupActivate: { es: "Activar", en: "Turn on" },
  setupNoCode: {
    es: "Sin código · sin dolores de cabeza.",
    en: "No code · no headaches.",
  },

  // ── Flow / repeat-purchase preview ──
  flowBought: { es: "Compró hace 30 días", en: "Bought 30 days ago" },
  flowWait: {
    es: "Espera el momento ideal",
    en: "Waits for the right moment",
  },
  flowSend: {
    es: "Envía la oferta de recompra",
    en: "Sends the repeat-purchase offer",
  },

  // ── Campaign preview ──
  campaignTitle: { es: "Nueva colección 👟", en: "New collection 👟" },
  campaignChannels: { es: "WhatsApp e Instagram", en: "WhatsApp and Instagram" },
  campaignSent: { es: "Enviada", en: "Sent" },
  campaignStatSent: { es: "Enviados", en: "Sent" },
  campaignStatDelivered: { es: "Entregados", en: "Delivered" },
  campaignStatRead: { es: "Leídos", en: "Read" },
  campaignStatReplied: { es: "Respondieron", en: "Replied" },

  // ── Product preview ──
  productName: { es: "Tenis Aura", en: "Aura Sneakers" },
  productCategory: { es: "Calzado · unisex", en: "Footwear · unisex" },
  productInStock: { es: "En stock · 8", en: "In stock · 8" },
  productDiscount: { es: "15% off", en: "15% off" },
  productSynced: {
    es: "Sincronizado con Shopify",
    en: "Synced with Shopify",
  },
  productUpToDate: { es: "al día", en: "up to date" },
  productOrderCreated: {
    es: "creado por la IA.",
    en: "created by AI.",
  },
  productOrderLead: { es: "Pedido", en: "Order" },

  // ── Live / mobile preview ──
  liveNow: { es: "En vivo", en: "Live" },
  liveFromPhone: { es: "Desde tu teléfono", en: "From your phone" },
  liveThem: {
    es: "¿Me lo pueden enviar hoy?",
    en: "Can you ship it today?",
  },
  liveYou: {
    es: "Sí, si confirmas antes de las 4 pm 🚚",
    en: "Yes, if you confirm before 4 pm 🚚",
  },
  liveTyping: { es: "El agente está respondiendo…", en: "The agent is replying…" },
  liveTakeOver: { es: "Tomar el control", en: "Take over" },

  // ── Call preview ──
  callOutbound: { es: "Llamada saliente", en: "Outgoing call" },
  callDialing: { es: "Marcando…", en: "Dialing…" },
  callLive: { es: "En curso", en: "In progress" },
  callAgent: { es: "Agente", en: "Agent" },
  callCustomer: { es: "Cliente", en: "Customer" },
  callLine1: {
    es: "Hola Laura, te llamo por tu pedido de los Tenis Aura.",
    en: "Hi Laura, I'm calling about your Aura Sneakers order.",
  },
  callLine2: {
    es: "¿Confirmas la entrega mañana en la mañana?",
    en: "Can you confirm delivery tomorrow morning?",
  },
  callLine3: { es: "Sí, ahí estaré.", en: "Yes, I'll be there." },
  callOutcome: { es: "Pedido confirmado", en: "Order confirmed" },
  callTranscript: { es: "Transcripción guardada", en: "Transcript saved" },

  // ── Contacts / segments preview ──
  contactsSegment: { es: "Compraron y no volvieron", en: "Bought once, never returned" },
  contactsMatches: { es: "{n} contactos", en: "{n} contacts" },
  contactsTagBuyer: { es: "Comprador", en: "Buyer" },
  contactsTagRepeat: { es: "Recurrente", en: "Repeat" },
  contactsTagCart: { es: "Carrito abandonado", en: "Abandoned cart" },
  contactsSpent: { es: "gastó", en: "spent" },
  contactsSaveSegment: { es: "Guardar como segmento", en: "Save as segment" },

  // ── Metrics preview ──
  metricsPerDollar: { es: "por cada $1 invertido", en: "per $1 invested" },
  metricsRevenue: { es: "Ingresos", en: "Revenue" },
  metricsRecovered: { es: "Recuperado", en: "Recovered" },
  metricsResponse: { es: "Respuesta", en: "Response" },
  metricsAgentRevenue7d: {
    es: "Ingresos del agente · 7 días",
    en: "Agent revenue · 7 days",
  },

  // ── Cierre de confianza (antes del CTA) ──
  finalTrustTitle: {
    es: "Todo por los canales oficiales.",
    en: "Everything through official channels.",
  },
  finalTrustTitleMuted: { es: "Sin baneos.", en: "No bans." },
  finalTrustBody: {
    es: "Cada mensaje sale por las APIs oficiales de Meta, con los permisos aprobados. Nada de WhatsApp Web ni números clonados: tu cuenta no se bloquea.",
    en: "Every message goes out through Meta's official APIs, with approved permissions. No WhatsApp Web, no cloned numbers: your account doesn't get blocked.",
  },

  // ── CTA ──
  ctaBadge: { es: "Pre-lanzamiento", en: "Pre-launch" },
  ctaTitle: {
    es: "Sé de los primeros en vender con IA.",
    en: "Be among the first to sell with AI.",
  },
  ctaSubtitle: {
    es: "Estamos abriendo cupos poco a poco. Déjanos tu correo y te avisamos apenas puedas entrar.",
    en: "We're opening spots gradually. Leave your email and we'll let you know the moment you can join.",
  },
  ctaNoCommitment: { es: "Sin compromiso", en: "No commitment" },
  ctaNoSpam: { es: "Sin spam", en: "No spam" },
  ctaFirstToKnow: { es: "Te avisamos primero", en: "First to know" },

  // ── Footer ──
  footerFeatures: { es: "Funciones", en: "Features" },
  footerTerms: { es: "Términos", en: "Terms" },
  footerPrivacy: { es: "Privacidad", en: "Privacy" },
  footerDeleteData: { es: "Eliminar datos", en: "Delete data" },
  footerRights: { es: "© 2026 riverz", en: "© 2026 riverz" },
} satisfies Namespace;
