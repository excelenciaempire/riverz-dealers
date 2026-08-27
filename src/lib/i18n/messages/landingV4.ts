import type { Namespace } from "./types";

/**
 * Copy de la portada editorial (riverz.co/portada-b).
 *
 * Registro deliberadamente calmo: un titular grande, una línea de apoyo, una
 * sola llamada a la acción, y todo lo demás en fichas. La página no enumera
 * funciones — cuenta un turno de trabajo y después muestra la caja de
 * herramientas.
 *
 * Falta a propósito: testimonios y cifras de facturación. El producto está en
 * prelanzamiento y un testimonio inventado se huele a un kilómetro.
 */
export const landingV4 = {
  // ── Metadatos (la página va noindex: es una variante para comparar) ──
  metaTitle: { es: "riverz", en: "riverz" },
  metaDescription: {
    es: "El sistema operativo de atención para tiendas: agentes de IA que atienden, deciden y crean el pedido en cada canal donde te escriben.",
    en: "The customer-experience operating system for online stores: AI agents that answer, decide, and create the order on every channel where people write you.",
  },

  // ── Barra de aviso ──
  bannerLead: { es: "Prelanzamiento", en: "Pre-launch" },
  bannerText: {
    es: "estamos abriendo cupos de a poco para las primeras tiendas.",
    en: "we're opening spots gradually for the first stores.",
  },

  // ── Navegación ──
  navHow: { es: "Cómo funciona", en: "How it works" },
  navCapabilities: { es: "Capacidades", en: "Capabilities" },
  navChannels: { es: "Canales", en: "Channels" },
  navCta: { es: "Pedir acceso", en: "Request access" },
  skipToContent: { es: "Ir al contenido", en: "Skip to content" },

  // ── Hero ──
  heroTitle: {
    es: "El sistema de atención que las tiendas necesitaban",
    en: "The customer-experience system online stores were missing",
  },
  heroSubtitle: {
    es: "Una sola capa de inteligencia que atiende, decide y ejecuta en cada canal donde te escriben.",
    en: "One intelligence layer that answers, decides, and acts on every channel where people write you.",
  },
  heroCta: { es: "Pedir acceso", en: "Request access" },
  heroImageAlt: {
    es: "Ilustración de un comerciante atendiendo por teléfono mientras prepara un pedido",
    en: "Illustration of a shopkeeper on the phone while wrapping an order",
  },

  // ── Muro de plataformas ──
  wallLabel: { es: "Conecta con", en: "Works with" },

  // ── Cómo funciona (escena fija de tres actos) ──
  howLabel: { es: "Cómo funciona", en: "How it works" },
  how1Title: { es: "Aprende tu tienda", en: "It learns your store" },
  how1Body: {
    es: "Lee tu catálogo, tus precios, tus envíos y tus reseñas. No hay que escribirle un guion: el producto es la fuente.",
    en: "It reads your catalog, prices, shipping, and reviews. No script to write: the product is the source.",
  },
  how1P1: { es: "Catálogo y stock en vivo", en: "Live catalog and stock" },
  how1P2: { es: "Precios, envíos y devoluciones", en: "Prices, shipping, returns" },
  how1P3: { es: "Tus reglas de negocio, en tus palabras", en: "Your business rules, in your words" },

  how2Title: { es: "Atiende donde te escriben", en: "It answers where they write" },
  how2Body: {
    es: "WhatsApp, Instagram, Messenger, Mercado Libre, correo, comentarios y llamadas. Una bandeja, una sola voz.",
    en: "WhatsApp, Instagram, Messenger, Mercado Libre, email, comments, and calls. One inbox, one voice.",
  },
  how2P1: { es: "Siete canales en una bandeja", en: "Seven channels, one inbox" },
  how2P2: { es: "Responde en segundos, a cualquier hora", en: "Replies in seconds, any hour" },
  how2P3: { es: "Pasa a una persona cuando conviene", en: "Hands off to a person when it matters" },

  how3Title: { es: "Cierra la venta", en: "It closes the sale" },
  how3Body: {
    es: "Recomienda, recupera el carrito, arma el pedido y lo crea en tu tienda con el link marcado.",
    en: "It recommends, recovers the cart, builds the order, and creates it in your store with a tagged link.",
  },
  how3P1: { es: "Recomendaciones con stock real", en: "Recommendations with real stock" },
  how3P2: { es: "Carritos abandonados y recompras", en: "Abandoned carts and repeat sales" },
  how3P3: { es: "El pedido, creado en tu tienda", en: "The order, created in your store" },

  // ── Bloque de dato ──
  figureLabel: { es: "El horario", en: "The hours" },
  figureLead: {
    es: "La mitad de los mensajes que recibe una tienda entran fuera de horario. Ahí es donde se pierde la venta, y es exactamente el turno que el agente cubre sin quejarse.",
    en: "Half the messages a store receives arrive after hours. That's where the sale is lost, and it's exactly the shift the agent covers without complaining.",
  },
  figureM1: { es: "canales en una bandeja", en: "channels, one inbox" },
  figureM2: { es: "herramientas que ejecuta", en: "tools it runs" },
  figureM3: { es: "minutos de espera", en: "minutes of waiting" },

  // ── Capacidades ──
  capsLabel: { es: "Capacidades", en: "Capabilities" },
  capsTitle: {
    es: "Una plataforma, no un chatbot",
    en: "A platform, not a chatbot",
  },
  capsBody: {
    es: "Cada tarjeta es algo que el agente hace solo, con datos reales de tu tienda.",
    en: "Every card is something the agent does on its own, with real data from your store.",
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
    es: "Empieza a vender mientras duermes",
    en: "Start selling while you sleep",
  },
  ctaBody: {
    es: "Déjanos tu correo y te avisamos apenas se abra un cupo.",
    en: "Leave your email and we'll let you know the moment a spot opens.",
  },
} satisfies Namespace;
