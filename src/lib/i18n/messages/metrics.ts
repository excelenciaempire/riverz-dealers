import type { Namespace } from "./types";

/** Metrics & attribution page, plus the shared canvas viewport, the
 *  requires-connection empty state and the support mode switcher. */
export const metrics = {
  // Metrics page header
  eyebrow: { es: "Análisis", en: "Analytics" },
  title: { es: "Métricas y atribución", en: "Metrics & attribution" },

  // Shopify-not-connected empty state
  connectShopifyTitle: {
    es: "Conecta Shopify para ver atribución",
    en: "Connect Shopify to see attribution",
  },
  connectShopifyDescription: {
    es: "Sin Shopify no podemos cruzar las órdenes con tus campañas y flujos.",
    en: "Without Shopify we can't match orders to your campaigns and flows.",
  },
  connectShopifyCta: { es: "Conectar Shopify", en: "Connect Shopify" },

  // Shopify read error
  shopifyReadError: {
    es: "No se pudieron leer las órdenes de Shopify ahora. Intenta de nuevo en un rato.",
    en: "Couldn't read your Shopify orders right now. Try again in a bit.",
  },

  // Summary cards
  cardCampaigns: { es: "Campañas", en: "Campaigns" },
  cardFlows: { es: "Flujos", en: "Flows" },
  cardInstagramAgent: { es: "Agente de Instagram", en: "Instagram Agent" },
  cardAutomations: { es: "Automatizaciones", en: "Automations" },
  withSales: { es: "{n} con ventas", en: "{n} with sales" },

  // Attribution disclaimer
  attributionNote: {
    es: "Cada lente atribuye por separado (último toque, 24h antes de la orden). Una misma venta puede contar en más de una, así que no las sumes como total.",
    en: "Each lens attributes separately (last touch, 24h before the order). A single sale can count in more than one, so don't add them up as a total.",
  },

  // Attribution table titles
  topCampaigns: { es: "Top campañas", en: "Top campaigns" },
  topFlows: { es: "Top flujos", en: "Top flows" },
  topInstagramCampaigns: {
    es: "Top campañas de Instagram",
    en: "Top Instagram campaigns",
  },
  topAutomations: { es: "Top automatizaciones", en: "Top automations" },

  // Attribution table empty states
  emptyCampaigns: {
    es: "Sin campañas con revenue atribuible en este rango.",
    en: "No campaigns with attributable revenue in this range.",
  },
  emptyFlows: {
    es: "Sin flujos con revenue atribuible en este rango.",
    en: "No flows with attributable revenue in this range.",
  },
  emptyInstagram: {
    es: "Sin ventas atribuidas al Agente de Instagram en este rango.",
    en: "No sales attributed to the Instagram Agent in this range.",
  },
  emptyAutomations: {
    es: "Sin automatizaciones con revenue atribuible en este rango.",
    en: "No automations with attributable revenue in this range.",
  },

  // Attribution table columns
  colName: { es: "Nombre", en: "Name" },
  colOrders: { es: "Órdenes", en: "Orders" },
  colRevenue: { es: "Revenue", en: "Revenue" },

  // Canvas viewport controls
  zoomOut: { es: "Reducir", en: "Zoom out" },
  zoomOutTitle: { es: "Reducir (Ctrl + rueda)", en: "Zoom out (Ctrl + scroll)" },
  zoomIn: { es: "Ampliar", en: "Zoom in" },
  zoomInTitle: { es: "Ampliar (Ctrl + rueda)", en: "Zoom in (Ctrl + scroll)" },
  fitTitle: { es: "Centrar y ajustar", en: "Center and fit" },
  center: { es: "Centrar", en: "Center" },
  centerTitle: { es: "Centrar todo el flujo", en: "Center the whole flow" },
  autoLayout: { es: "Auto-organizar", en: "Auto-arrange" },
  autoLayoutTitle: {
    es: "Reordenar nodos automáticamente",
    en: "Auto-arrange nodes",
  },

  // Requires-connection empty state
  connectChannel: { es: "Conectar un canal", en: "Connect a channel" },

  // Support mode switcher
  modeAiTitle: { es: "Asistente con IA", en: "AI Assistant" },
  modeAiHint: {
    es: "Responde solo, 24/7, con el contexto de cada chat.",
    en: "Replies on its own, 24/7, with the context of each chat.",
  },
  modeFlowsTitle: { es: "Flujos", en: "Flows" },
  modeFlowsHint: {
    es: "Botones que tú defines; el cliente toca y avanza, sin IA.",
    en: "Buttons you define; the customer taps to move forward, no AI.",
  },
} satisfies Namespace;
