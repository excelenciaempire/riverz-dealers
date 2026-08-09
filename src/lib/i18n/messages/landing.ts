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
  heroTitleLead: { es: "Agentes de IA que", en: "AI agents that" },
  heroTitleMuted: { es: "cierran la venta.", en: "close the sale." },
  heroSubtitle: {
    es: "Atienden, deciden y ejecutan en WhatsApp, Instagram, Messenger, Mercado Libre, correo y llamadas. Recomiendan, recuperan carritos y crean el pedido en tu tienda.",
    en: "They engage, decide, and act on WhatsApp, Instagram, Messenger, Mercado Libre, email, and calls. They recommend, recover carts, and create the order in your store.",
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
  sec01Title: { es: "Un vendedor con IA", en: "An AI salesperson" },
  sec01TitleMuted: {
    es: "que conoce tus productos.",
    en: "that knows your products.",
  },
  sec01Body: {
    es: "Conoce tu catálogo, tus precios y tus envíos al derecho y al revés. Recomienda, suma lo que combina para subir el ticket y cierra la compra como tu mejor vendedor, también mientras duermes.",
    en: "It knows your catalog, prices, and shipping inside out. It recommends, adds what pairs well to raise the ticket, and closes the sale like your best rep, even while you sleep.",
  },

  sec02Title: { es: "Recupera cada", en: "Recover every" },
  sec02TitleMuted: {
    es: "carrito abandonado.",
    en: "abandoned cart.",
  },
  sec02Body: {
    es: "Cuando alguien deja la compra a medias, el agente le escribe solo, resuelve la duda y recupera la venta antes de que se enfríe.",
    en: "When someone leaves a purchase half-finished, the agent reaches out on its own, clears up the question, and recovers the sale before it goes cold.",
  },

  sec03Title: {
    es: "Recompras automáticas,",
    en: "Automatic repeat sales,",
  },
  sec03TitleMuted: {
    es: "sin que muevas un dedo.",
    en: "without lifting a finger.",
  },
  sec03Body: {
    es: "Seguimiento post-venta y recordatorios de recompra para tus clientes dormidos. Configuras las recompras una sola vez y el agente las envía cuando es más probable que vuelvan a comprar.",
    en: "Post-sale follow-ups and repeat-purchase reminders for dormant customers. Set it up once and the agent reaches out exactly when they're most likely to buy again.",
  },

  sec04Title: { es: "Atiende y avisa,", en: "Always answering," },
  sec04TitleMuted: { es: "las 24 horas.", en: "around the clock." },
  sec04Body: {
    es: "Confirma cada pedido, envía el número de guía y resuelve dudas al instante. Tus clientes siempre saben en qué va su compra, a cualquier hora.",
    en: "It confirms every order, sends the tracking number, and answers questions instantly. Your customers always know where their order stands, any time of day.",
  },

  // En vivo / móvil — mirar al agente trabajar y entrar cuando quieras.
  secLiveTitle: { es: "Míralo trabajar,", en: "Watch it work," },
  secLiveTitleMuted: { es: "desde tu teléfono.", en: "from your phone." },
  secLiveBody: {
    es: "Ves en vivo lo que le responde a cada cliente y, si quieres, entras en la conversación con un toque. Desde el computador o el celular.",
    en: "You see in real time what it replies to every customer and, if you want, you step into the conversation with one tap. From your desktop or your phone.",
  },

  // Voz — sección propia: el agente también habla por teléfono.
  secVoiceTitle: { es: "Y cuando hace falta,", en: "And when it matters," },
  secVoiceTitleMuted: {
    es: "levanta el teléfono.",
    en: "it picks up the phone.",
  },
  secVoiceBody: {
    es: "Conversa con voz natural: llama para confirmar pedidos contraentrega, recuperar carritos y hacer seguimiento, y también atiende las llamadas que entran. Cada llamada queda transcrita y con su resultado.",
    en: "It speaks with a natural voice: it calls to confirm cash-on-delivery orders, recover carts, and follow up, and it answers incoming calls too. Every call is transcribed and closed with an outcome.",
  },

  // Contactos y segmentos — la base de clientes que se ordena sola.
  secContactsTitle: { es: "Tu base de clientes,", en: "Your customer base," },
  secContactsTitleMuted: { es: "ordenada sola.", en: "sorted by itself." },
  secContactsBody: {
    es: "Cada conversación y cada pedido enriquecen la ficha: qué compró, cuánto gastó, dónde vive. Guarda un filtro como segmento y lánzale una campaña.",
    en: "Every conversation and every order enriches the contact: what they bought, how much they spent, where they live. Save a filter as a segment and launch a campaign to it.",
  },

  sec05Title: { es: "También responde", en: "It also replies to" },
  sec05TitleMuted: { es: "los comentarios.", en: "your comments." },
  sec05Body: {
    es: "Responde al instante cada comentario en tus publicaciones y anuncios de Instagram y Facebook, y se lleva la conversación al DM para cerrar la venta.",
    en: "It instantly replies to every comment on your Instagram and Facebook posts and ads, then moves the conversation to DMs to close the sale.",
  },

  sec06Title: { es: "Campañas masivas en", en: "Bulk campaigns on" },
  sec06TitleMuted: {
    es: "WhatsApp e Instagram.",
    en: "WhatsApp and Instagram.",
  },
  sec06Body: {
    es: "Lanza una promoción a miles de contactos por WhatsApp e Instagram y mira en vivo quién la recibió, quién la leyó, quién te respondió y quién te compró.",
    en: "Launch a promo to thousands of contacts on WhatsApp and Instagram and watch in real time who received it, read it, replied, and bought.",
  },

  sec07Title: { es: "Y todo, en una", en: "And it all lives in" },
  sec07TitleMuted: { es: "sola bandeja.", en: "a single inbox." },
  sec07Body: {
    es: "WhatsApp, Instagram, Messenger, Mercado Libre y correo en una sola pantalla. Tu equipo y el agente trabajan codo a codo y a ningún cliente lo dejan en visto.",
    en: "WhatsApp, Instagram, Messenger, Mercado Libre, and email on one screen. Your team and the agent work side by side, and no customer is ever left on read.",
  },

  sec08Title: { es: "Conecta tu tienda", en: "Connect your store" },
  sec08TitleMuted: {
    es: "y vende con datos reales.",
    en: "and sell with live data.",
  },
  sec08Body: {
    es: "Shopify, WooCommerce, Tiendanube o Mercado Libre: inventario, precios y pedidos sincronizados. El agente recomienda, arma el pedido y cobra con información al día.",
    en: "Shopify, WooCommerce, Tiendanube, or Mercado Libre: inventory, prices, and orders in sync. The agent recommends, builds the order, and charges with up-to-date information.",
  },

  sec09Title: { es: "Listo en minutos,", en: "Ready in minutes," },
  sec09TitleMuted: {
    es: "con unos cuantos clics.",
    en: "with just a few clicks.",
  },
  sec09Body: {
    es: "Conectas tus canales y tu tienda, activas el agente y ya está vendiendo. Sin código y sin los dolores de cabeza de otras plataformas.",
    en: "Connect your channels and your store, turn on the agent, and it's already selling. No code and none of the headaches of other platforms.",
  },

  sec10Title: { es: "Un ROAS claro,", en: "A clear ROAS," },
  sec10TitleMuted: { es: "no corazonadas.", en: "not gut feelings." },
  sec10Body: {
    es: "Cada venta queda atribuida al agente, así sabes cuánto te devuelve cada peso que inviertes. Y como contesta en segundos y atiende muchos chats a la vez, te rinde más que cualquier humano.",
    en: "Every sale is attributed to the agent, so you know the return on every dollar you invest. And since it replies in seconds and handles many chats at once, it does more than any human could.",
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
