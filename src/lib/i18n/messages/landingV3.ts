import type { Namespace } from "./types";

/**
 * Copy de la portada «Papel y Señal» (riverz.co/portada).
 *
 * No es otra redacción de la misma página como `landingV2`: es una portada
 * distinta, con su propia estructura de seis secciones. Por eso tiene claves
 * propias en vez de las mismas con otras palabras.
 *
 * Lo que reutiliza del catálogo `landing` —los títulos de las trece funciones,
 * las etiquetas de las vistas previas, el formulario de lista de espera y el
 * pie— se referencia allí directamente con `t("landing.…")`, para que corregir
 * una función no obligue a corregirla dos veces.
 *
 * Falta a propósito: números de resultados. El producto está en
 * prelanzamiento; el dato grande de la portada es el horario (24/7) y las tres
 * cifras de apoyo son capacidades verificables, no promesas de facturación.
 */
export const landingV3 = {
  // ── Metadatos (pestaña y buscadores; la página va noindex) ──
  metaTitle: { es: "riverz", en: "riverz" },
  metaDescription: {
    es: "Agentes de IA que atienden, recomiendan y crean el pedido en WhatsApp, Instagram, Messenger, Mercado Libre, correo y llamadas. 24/7, sin que contestes nada.",
    en: "AI agents that answer, recommend, and create the order on WhatsApp, Instagram, Messenger, Mercado Libre, email, and calls. 24/7, without you replying to anything.",
  },

  // ── Cabecera ──
  navWaitlist: { es: "Lista de espera", en: "Join the waitlist" },
  skipToContent: { es: "Ir al contenido", en: "Skip to content" },

  // ── [01] Hero ──
  // El titular se compone de tres partes porque la del medio va sobre la
  // barra amarilla que se dibuja al entrar en pantalla.
  heroRuleLeft: { es: "AGENTE AUTÓNOMO", en: "AUTONOMOUS AGENT" },
  heroRuleRight: { es: "PRELANZAMIENTO", en: "PRE-LAUNCH" },
  heroTitleA: { es: "Tu tienda", en: "Your store" },
  heroTitleMark: { es: "vende", en: "sells" },
  heroTitleB: { es: "mientras duermes.", en: "while you sleep." },
  heroSubtitle: {
    es: "Agentes de IA que atienden, recomiendan y crean el pedido en WhatsApp, Instagram, Messenger, Mercado Libre, correo y llamadas. Sin que contestes nada.",
    en: "AI agents that answer, recommend, and create the order on WhatsApp, Instagram, Messenger, Mercado Libre, email, and calls. Without you replying to anything.",
  },
  heroCta: { es: "Entrar a la lista", en: "Join the list" },

  // ── [02] Prueba ──
  proofRuleLeft: { es: "EL HORARIO", en: "THE HOURS" },
  proofRuleRight: { es: "SIN TURNOS", en: "NO SHIFTS" },
  proofTitle: {
    es: "El turno que nadie quiere, cubierto.",
    en: "The shift nobody wants, covered.",
  },
  proofBody: {
    es: "La mitad de los mensajes que llegan a una tienda entran fuera de horario. El agente no cierra, no descansa y no cambia de humor.",
    en: "Half the messages a store gets arrive after hours. The agent doesn't close, doesn't rest, and doesn't have moods.",
  },
  proofM1Label: { es: "canales en una bandeja", en: "channels, one inbox" },
  proofM2Label: { es: "herramientas que ejecuta", en: "tools it runs" },
  proofM3Label: { es: "minutos de espera", en: "minutes of waiting" },

  // ── [03] El turno (escenario negro) ──
  stageRuleLeft: { es: "EL TURNO", en: "THE SHIFT" },
  stageRuleRight: { es: "03:14", en: "03:14" },
  stageTitleA: { es: "Un mensaje a las", en: "A message at" },
  stageTitleMark: { es: "3 a. m.", en: "3 a.m." },
  stageTitleB: { es: "no espera a mañana.", en: "doesn't wait for morning." },
  stageAct1Title: { es: "Llega", en: "It arrives" },
  stageAct1Body: {
    es: "Entra por el canal donde el cliente ya estaba. No hay formulario ni ticket.",
    en: "It lands on the channel the customer was already using. No form, no ticket.",
  },
  stageAct2Title: { es: "Responde", en: "It answers" },
  stageAct2Body: {
    es: "Lee el catálogo, mira el pedido, contesta con el precio y el stock reales.",
    en: "It reads the catalog, checks the order, and answers with real price and stock.",
  },
  stageAct3Title: { es: "Cierra", en: "It closes" },
  stageAct3Body: {
    es: "Arma el pedido y lo crea en tu tienda. Con el link marcado, para saber que fue suyo.",
    en: "It builds the order and creates it in your store, with a tagged link, so you know it was its doing.",
  },
  stageHint: { es: "Desliza para mover la mesa", en: "Drag to move the table" },

  // ── [04] Índice ──
  indexRuleLeft: { es: "ÍNDICE", en: "INDEX" },
  indexRuleRight: { es: "TRECE FUNCIONES", en: "THIRTEEN FEATURES" },
  indexTitle: {
    es: "Todo lo que hace, en trece renglones.",
    en: "Everything it does, in thirteen lines.",
  },
  indexHint: {
    es: "Pasa el cursor por un renglón",
    en: "Hover over a line",
  },

  // ── [05] Canales ──
  channelsRuleLeft: { es: "CANALES", en: "CHANNELS" },
  channelsRuleRight: { es: "APIS OFICIALES", en: "OFFICIAL APIS" },
  channelsTitle: {
    es: "Donde ya te escriben.",
    en: "Where they already write you.",
  },
  channelsBody: {
    es: "Cada mensaje sale por las APIs oficiales, con los permisos aprobados. Nada de WhatsApp Web ni números clonados: tu cuenta no se bloquea.",
    en: "Every message goes out through the official APIs, with approved permissions. No WhatsApp Web, no cloned numbers: your account doesn't get blocked.",
  },
  channelsCalls: { es: "Llamadas", en: "Calls" },

  // ── [06] Cierre ──
  closeRuleLeft: { es: "LISTA DE ESPERA", en: "WAITLIST" },
  closeRuleRight: { es: "CUPOS LIMITADOS", en: "LIMITED SPOTS" },
  closeTitleA: { es: "Sé de los", en: "Be among the" },
  closeTitleMark: { es: "primeros", en: "first" },
  closeTitleB: { es: "en vender con IA.", en: "to sell with AI." },
  closeBody: {
    es: "Estamos abriendo cupos poco a poco. Déjanos tu correo y te avisamos apenas puedas entrar.",
    en: "We're opening spots gradually. Leave your email and we'll let you know the moment you can join.",
  },
} satisfies Namespace;
