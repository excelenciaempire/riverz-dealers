import type { Namespace } from "./types";

/**
 * Copy de la portada editorial (riverz.co/portada-b).
 *
 * Dos reglas que mandan sobre todo lo demás:
 *
 * 1. **La voz es la de la portada principal.** Concreta, con verbos adelante y
 *    sin sustantivos de categoría. El titular, el subtítulo y las trece
 *    funciones NO se reescriben acá: se leen del catálogo `landing`, que es el
 *    que ya está trabajado. Este archivo solo agrega lo que esta portada tiene
 *    y la otra no.
 *
 * 2. **No sonar como el resto del mercado.** Nada de «la plataforma de
 *    experiencia del cliente», «el sistema operativo de la atención» ni
 *    «impulsado por IA». Esas frases las dice todo el mundo y no significan
 *    nada. Acá se dice qué hace: contesta, recomienda, arma el pedido, llama
 *    por teléfono, y si quieres cambiar algo se lo pides y lo hace.
 *
 * Falta a propósito: testimonios y cifras de facturación. El producto está en
 * prelanzamiento y un testimonio inventado se huele a un kilómetro.
 */
export const landingV4 = {
  // ── Metadatos (la página va noindex: es una variante para comparar) ──
  metaTitle: { es: "riverz", en: "riverz" },
  metaDescription: {
    es: "Agentes de IA que atienden, deciden y ejecutan en WhatsApp, Instagram, Messenger, Mercado Libre, correo y llamadas: recomiendan, recuperan carritos y crean el pedido en tu tienda. 24/7, sin que tengas que responder.",
    en: "AI agents that engage, decide, and act on WhatsApp, Instagram, Messenger, Mercado Libre, email, and calls: they recommend, recover carts, and create the order in your store. 24/7, without you replying.",
  },

  // ── Barra de aviso ──
  bannerLead: { es: "Prelanzamiento", en: "Pre-launch" },
  bannerText: {
    es: "estamos abriendo cupos de a poco para las primeras tiendas.",
    en: "we're opening spots gradually for the first stores.",
  },

  // ── Navegación ──
  navHow: { es: "Cómo trabaja", en: "How it works" },
  navCapabilities: { es: "Qué hace", en: "What it does" },
  navOperator: { es: "Operator", en: "Operator" },
  navChannels: { es: "Canales", en: "Channels" },
  navCta: { es: "Pedir acceso", en: "Request access" },
  skipToContent: { es: "Ir al contenido", en: "Skip to content" },

  // ── Muro de plataformas ──
  wallLabel: { es: "Trabaja con", en: "Works with" },

  // ── Cómo trabaja (escena fija de tres actos) ──
  howLabel: { es: "Cómo trabaja", en: "How it works" },
  how1Title: { es: "Se aprende tu tienda", en: "It learns your store" },
  how1Body: {
    es: "Lee tu catálogo, tus precios, tus envíos y tus reseñas. No hay que escribirle un guion ni armarle un árbol de respuestas: el producto es la fuente.",
    en: "It reads your catalog, prices, shipping, and reviews. No script to write, no decision tree to build: the product is the source.",
  },
  how1P1: { es: "Catálogo y stock en vivo", en: "Live catalog and stock" },
  how1P2: { es: "Precios, envíos y devoluciones", en: "Prices, shipping, returns" },
  how1P3: { es: "Tus reglas, escritas en tus palabras", en: "Your rules, in your own words" },

  how2Title: { es: "Contesta donde te escriben", en: "It answers where they write" },
  how2Body: {
    es: "WhatsApp, Instagram, Messenger, Mercado Libre, correo, comentarios y llamadas. Una sola bandeja y una sola voz, a cualquier hora.",
    en: "WhatsApp, Instagram, Messenger, Mercado Libre, email, comments, and calls. One inbox and one voice, any hour of the day.",
  },
  how2P1: { es: "Siete canales en una bandeja", en: "Seven channels, one inbox" },
  how2P2: { es: "Contesta en segundos, de madrugada también", en: "Replies in seconds, at 3 a.m. too" },
  how2P3: { es: "Te pasa el chat cuando conviene", en: "Hands the chat to you when it matters" },

  how3Title: { es: "Cierra y deja el pedido hecho", en: "It closes and leaves the order done" },
  how3Body: {
    es: "Recomienda con stock real, recupera el carrito, arma el pedido y lo crea en tu tienda con el link marcado, para que sepas que fue suyo.",
    en: "It recommends with real stock, recovers the cart, builds the order, and creates it in your store with a tagged link, so you know it was its doing.",
  },
  how3P1: { es: "Recomienda solo lo que hay", en: "It only recommends what's in stock" },
  how3P2: { es: "Carritos abandonados y recompras", en: "Abandoned carts and repeat sales" },
  how3P3: { es: "El pedido, creado en tu tienda", en: "The order, created in your store" },

  // ── Bloque de dato ──
  figureLabel: { es: "El horario", en: "The hours" },
  figureLead: {
    es: "La mitad de los mensajes que le llegan a una tienda entran fuera de horario. Ahí se pierde la venta, y ése es exactamente el turno que cubre sin quejarse.",
    en: "Half the messages a store gets arrive after hours. That's where the sale is lost, and that's exactly the shift it covers without complaining.",
  },
  figureM1: { es: "canales en una bandeja", en: "channels, one inbox" },
  figureM2: { es: "herramientas que ejecuta", en: "tools it runs" },
  figureM3: { es: "minutos de espera", en: "minutes of waiting" },

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

  // El dato de la ficha sin vista previa. Sale del propio cuerpo de sec09,
  // que dice «Sin código»: no es una cifra inventada.
  capsZeroLabel: { es: "líneas de código", en: "lines of code" },

  // ── Operator ──
  // La pieza que no tiene nadie más en la categoría, y por eso se lleva un
  // bloque entero en vez de una ficha.
  operatorLabel: { es: "Operator", en: "Operator" },
  operatorTitle: {
    es: "Y si quieres cambiar algo, se lo pides",
    en: "And if you want something changed, you just ask",
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

  // Texto que se escribe solo dentro de la animación del Operator.
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
