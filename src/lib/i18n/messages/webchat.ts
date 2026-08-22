import type { Namespace } from "./types";

/**
 * Chat web — la página de configuración del widget que el comercio instala en
 * su tienda. Todo lo de acá lo lee el comercio en el panel.
 *
 * Lo que el VISITANTE ve dentro del chat no sale de acá: sigue el idioma del
 * agente, igual que los mensajes que el agente manda por WhatsApp.
 */
export const webchat = {
  title: { es: "Chat web", en: "Web chat" },
  subtitle: {
    es: "El chat de tu tienda, atendido por tu agente.",
    en: "Your store's chat, handled by your agent.",
  },

  // ── Estado ──
  enable: { es: "Chat web activo", en: "Web chat live" },
  enableHint: {
    es: "Apágalo para dejar el chat fuera de la tienda sin quitar el código.",
    en: "Turn it off to take the chat down without removing the code.",
  },
  live: { es: "Activo", en: "Live" },
  off: { es: "Apagado", en: "Off" },

  // ── Instalación ──
  install: { es: "Instalación", en: "Install" },
  installHint: {
    es: "Pega este código antes de </body> en tu tienda.",
    en: "Paste this code before </body> in your store.",
  },
  installAuto: { es: "Instalar en la tienda", en: "Install on the store" },
  installAutoHint: {
    es: "Lo ponemos nosotros en Shopify. No hace falta tocar el código del tema.",
    en: "We add it to Shopify for you. No need to touch your theme code.",
  },
  installAutoOn: {
    es: "Ya está puesto en tu tienda.",
    en: "It is already live on your store.",
  },
  installNow: { es: "Instalar", en: "Install" },
  uninstall: { es: "Quitar", en: "Remove" },
  installedOk: { es: "Listo, el chat ya está en tu tienda.", en: "Done, the chat is live on your store." },
  uninstalledOk: { es: "Lo sacamos de tu tienda.", en: "Removed from your store." },
  installFailed: { es: "No se pudo instalar.", en: "Could not install." },
  copy: { es: "Copiar", en: "Copy" },
  copied: { es: "Copiado", en: "Copied" },
  domains: { es: "Dominios permitidos", en: "Allowed domains" },
  domainsHint: {
    es: "El chat solo abre en estos dominios. Los subdominios se incluyen.",
    en: "The chat only opens on these domains. Subdomains are included.",
  },
  domainsEmpty: {
    es: "Agrega tu dominio para que el chat pueda abrir.",
    en: "Add your domain so the chat can open.",
  },
  domainsDetected: { es: "De tu tienda:", en: "From your store:" },
  // Las dos razones por las que el codigo esta pegado y el chat no aparece.
  whyOff: {
    es: "El chat está apagado: aunque el código esté puesto, no aparece en la tienda.",
    en: "The chat is off: even with the code in place, it won't show on the store.",
  },
  whyNoDomains: {
    es: "Falta el dominio de tu tienda. Sin él el chat no abre en ninguna página.",
    en: "Your store domain is missing. Without it the chat won't open anywhere.",
  },
  domainAdd: { es: "Agregar dominio", en: "Add domain" },
  domainPlaceholder: { es: "mitienda.com", en: "mystore.com" },

  // ── Apariencia ──
  appearance: { es: "Apariencia", en: "Appearance" },
  color: { es: "Color", en: "Color" },
  position: { es: "Posición", en: "Position" },
  positionRight: { es: "Derecha", en: "Right" },
  positionLeft: { es: "Izquierda", en: "Left" },
  brandName: { es: "Nombre visible", en: "Display name" },
  greeting: { es: "Saludo", en: "Greeting" },
  greetingPlaceholder: {
    es: "Hola, ¿en qué te ayudo?",
    en: "Hi, how can I help?",
  },
  avatar: { es: "Imagen", en: "Image" },
  avatarPlaceholder: { es: "https://…", en: "https://…" },

  // ── Comportamiento ──
  behavior: { es: "Comportamiento", en: "Behavior" },
  agent: { es: "Agente que atiende", en: "Agent on duty" },
  agentAuto: { es: "El que corresponda", en: "Whichever applies" },
  agentHint: {
    es: "Sin elegir uno, atiende el agente asignado a este canal.",
    en: "Left unset, the agent assigned to this channel takes over.",
  },
  requireEmail: { es: "Pedir correo antes de escribir", en: "Ask for email first" },
  requireEmailHint: {
    es: "Suma fricción. Si compra, el correo se captura igual.",
    en: "Adds friction. On purchase, the email is captured anyway.",
  },

  // ── Resultados ──
  results: { es: "Resultados", en: "Results" },
  conversations: { es: "Conversaciones", en: "Conversations" },
  resolvedByAi: { es: "Resueltas por IA", en: "Resolved by AI" },
  resolutionRate: { es: "Resueltas sin humano", en: "Resolved without a human" },
  satisfaction: { es: "Quedaron conformes", en: "Were satisfied" },
  ratedCount: { es: "{n} calificaron", en: "{n} rated" },
  firstResponse: { es: "Primera respuesta", en: "First response" },
  escalated: { es: "Pasadas a una persona", en: "Handed to a person" },
  ordersAttributed: { es: "Pedidos del chat", en: "Orders from chat" },
  revenue: { es: "Vendido por el chat", en: "Sold through chat" },
  resultsEmpty: {
    es: "Todavía no hay conversaciones por este canal.",
    en: "No conversations on this channel yet.",
  },
  period: { es: "Últimos 30 días", en: "Last 30 days" },

  // ── Guardado ──
  save: { es: "Guardar", en: "Save" },
  saving: { es: "Guardando…", en: "Saving…" },
  saved: { es: "Guardado", en: "Saved" },
  saveFailed: { es: "No se pudo guardar", en: "Couldn't save" },
} satisfies Namespace;
