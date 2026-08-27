import type { Namespace } from "./types";

/** Products (/productos, /productos/[id]) and orders (/pedidos): catalog
 *  list/editor, AI research, FAQs, and the AI-created orders table. */
export const products = {
  // --- /productos (list) ---
  title: { es: "Productos", en: "Products" },
  sync: { es: "Sincronizar", en: "Sync" },
  syncError: { es: "No se pudo sincronizar", en: "Couldn't sync" },
  syncCatalogError: {
    es: "No se pudo sincronizar el catálogo.",
    en: "Couldn't sync the catalog.",
  },
  syncedCount: { es: "{n} sincronizados", en: "{n} synced" },
  deletedCount: { es: "{n} eliminados", en: "{n} deleted" },
  catalogUpToDate: { es: "Catálogo al día", en: "Catalog up to date" },
  loadError: {
    es: "No se pudieron cargar los productos.",
    en: "Couldn't load products.",
  },

  // Create product dialog
  newProduct: { es: "Nuevo producto", en: "New product" },
  productName: { es: "Nombre del producto", en: "Product name" },
  productNamePlaceholder: {
    es: "Ej: Sérum facial 30ml",
    en: "E.g. 30ml face serum",
  },
  cancel: { es: "Cancelar", en: "Cancel" },
  createAndEdit: { es: "Crear y editar", en: "Create and edit" },
  nameRequired: { es: "Ponle un nombre al producto.", en: "Give the product a name." },
  createError: { es: "No se pudo crear el producto.", en: "Couldn't create the product." },

  // Aviso de tienda desconectada. Genérico a propósito: el workspace puede
  // tener Shopify, Tiendanube o WooCommerce, y nombrar la equivocada manda al
  // comercio a reconectar una tienda que nunca tuvo.
  shopifyNotConnected: {
    es: "Tu tienda no está conectada",
    en: "Your store isn't connected",
  },
  shopifyReconnectHint: {
    es: "Para sincronizar tu catálogo actual, vuelve a conectarla.",
    en: "To sync your current catalog, connect it again.",
  },
  connect: { es: "Conectar", en: "Connect" },

  // Product card
  fieldsComplete: {
    es: "{done} de {total} campos clave completos",
    en: "{done} of {total} key fields complete",
  },
  trained: { es: "Entrenado", en: "Trained" },
  trainingError: { es: "Error de entrenamiento", en: "Training error" },
  agentsAssigned: {
    es: "{n} agente(s) asignado(s)",
    en: "{n} agent(s) assigned",
  },

  // --- /productos/[id] (editor) ---
  productNotFoundDot: { es: "Producto no encontrado.", en: "Product not found." },
  back: { es: "Volver", en: "Back" },
  product: { es: "Producto", en: "Product" },
  loadProductError: {
    es: "No se pudo cargar el producto.",
    en: "Couldn't load the product.",
  },

  // Media gallery
  removeImage: { es: "Quitar imagen", en: "Remove image" },
  add: { es: "Agregar", en: "Add" },
  sessionExpired: { es: "Sesión expirada", en: "Session expired" },
  uploadImageError: {
    es: "No se pudo subir la imagen.",
    en: "Couldn't upload the image.",
  },

  // Core fields
  name: { es: "Nombre", en: "Name" },
  description: { es: "Descripción", en: "Description" },
  prices: { es: "Precios", en: "Prices" },
  pricesUnitsHint: {
    es: "Las unidades deben coincidir con las del pedido para reconocer la oferta de cada comprador.",
    en: "Units must match the order to recognize each buyer's offer.",
  },
  offersAutoDetectedHint: {
    es: "Detectadas de tu página. Revísalas y guarda.",
    en: "Auto-detected from your page. Review and save.",
  },
  offerName: { es: "Oferta", en: "Offer" },
  offerNamePlaceholder: {
    es: "Ej: 3 unidades + 1 gratis",
    en: "E.g. 3 units + 1 free",
  },
  offerPrice: { es: "Precio", en: "Price" },
  units: { es: "Unidades", en: "Units" },
  unitsSuffix: { es: "uds", en: "u" },
  unitsPlaceholder: { es: "uds", en: "u" },
  currency: { es: "Moneda", en: "Currency" },
  removeOffer: { es: "Quitar oferta", en: "Remove offer" },
  addOffer: { es: "Agregar oferta", en: "Add offer" },
  benefits: { es: "Beneficios", en: "Benefits" },
  onePerLine: { es: "Uno por línea.", en: "One per line." },
  onePerLineShort: { es: "Una por línea", en: "One per line" },

  // Websites
  websites: { es: "Sitios web", en: "Websites" },
  websitesHint: {
    es: "Hasta 5. El agente aprende de lo que digan.",
    en: "Up to 5. The agent learns from their content.",
  },
  open: { es: "Abrir", en: "Open" },
  removeSite: { es: "Quitar sitio", en: "Remove site" },
  addAnotherSite: { es: "Agregar otro sitio", en: "Add another site" },
  rereadAll: { es: "Re-leer todos", en: "Re-read all" },
  lastRead: { es: "Última lectura:", en: "Last read:" },

  // Scrape / research toasts
  saved: { es: "Cambios guardados.", en: "Changes saved." },
  saveError: { es: "Error al guardar.", en: "Error saving." },
  saveFailed: { es: "No se pudo guardar", en: "Couldn't save" },
  readPagesError: { es: "Error al leer las páginas", en: "Error reading the pages" },
  readPagesErrorDot: {
    es: "Error al leer las páginas.",
    en: "Error reading the pages.",
  },
  pagesRead: {
    es: "Leídas {sites} página(s).",
    en: "Read {sites} page(s).",
  },
  pagesReadWithFailures: {
    es: "Leídas {sites} página(s), {failed} fallaron.",
    en: "Read {sites} page(s), {failed} failed.",
  },
  researchError: {
    es: "Error al generar investigación",
    en: "Error generating research",
  },
  researchErrorDot: {
    es: "Error al generar investigación.",
    en: "Error generating research.",
  },
  researchReady: {
    es: "Investigación lista ({count} FAQs).",
    en: "Research ready ({count} FAQs).",
  },

  // Advanced selling context (collapsible)
  sellingContext: { es: "Contexto para vender", en: "Selling context" },
  sellingContextSubtitle: {
    es: "Opcional. Afina cómo habla el agente de este producto.",
    en: "Optional. Fine-tunes how the agent talks about this product.",
  },
  objections: { es: "Objeciones y respuesta", en: "Objections and rebuttal" },
  objectionsHint: {
    es: "Una por línea: objeción | respuesta",
    en: "One per line: objection | rebuttal",
  },
  whatToEmphasize: { es: "Qué enfatizar", en: "What to emphasize" },
  assistantNotes: { es: "Notas para el asistente", en: "Notes for the assistant" },
  assistantNotesHint: {
    es: "Lo que no está en la página pero debe saber.",
    en: "What isn't on the page but it should know.",
  },
  neverSay: { es: "Nunca digas", en: "Never say" },
  escalateIfMentions: {
    es: "Pasar a humano si menciona",
    en: "Hand off to a human if they mention",
  },
  healthSensitive: {
    es: "Producto sensible a temas de salud (el bot evita afirmaciones médicas)",
    en: "Health-sensitive product (the bot avoids medical claims)",
  },

  // FAQs (collapsible)
  faqs: { es: "Preguntas frecuentes", en: "FAQs" },
  faqsSubtitle: {
    es: "Las tuyas tienen prioridad sobre las de la IA.",
    en: "Yours take priority over the AI's.",
  },
  removeFaq: { es: "Quitar FAQ", en: "Remove FAQ" },
  aiGenerated: { es: "Generadas por IA", en: "AI-generated" },
  adopted: { es: "Adoptada ✓", en: "Adopted ✓" },
  adopt: { es: "Adoptar", en: "Adopt" },

  // Save bar
  syncedFromShopify: {
    es: "Sincronizado desde Shopify",
    en: "Synced from Shopify",
  },
  manualProduct: { es: "Producto manual", en: "Manual product" },
  generateResearch: { es: "Generar investigación", en: "Generate research" },
  saveChanges: { es: "Guardar cambios", en: "Save changes" },

  // --- Eliminar producto ---
  delete: { es: "Eliminar", en: "Delete" },
  deleteTitle: { es: "Eliminar producto", en: "Delete product" },
  deleteBody: {
    es: "Se borra «{name}» y toda su información: investigación, FAQs, precios e imágenes. No se puede deshacer.",
    en: "This deletes “{name}” and all its information: research, FAQs, prices and images. It can't be undone.",
  },
  deleteAgentsWarning: {
    es: "Se quitará de {n} asistente(s).",
    en: "It will be removed from {n} assistant(s).",
  },
  deleteSyncedWarning: {
    es: "Al sincronizar el catálogo volverá si sigue en la tienda.",
    en: "Syncing the catalog will bring it back if it's still in the store.",
  },
  deleted: { es: "Producto eliminado", en: "Product deleted" },
  deleteError: {
    es: "No se pudo eliminar el producto.",
    en: "Couldn't delete the product.",
  },

  // --- /pedidos (orders) ---
  ordersTitle: { es: "Pedidos", en: "Orders" },
  ordersSubtitle: {
    es: "Pedidos que tu asistente cerró en el chat.",
    en: "Orders your assistant closed in the chat.",
  },
  ordersLoadError: { es: "No se pudieron cargar los pedidos.", en: "Couldn't load orders." },
  ordersEmptyTitle: { es: "Aún no hay pedidos", en: "No orders yet" },

  // Orders table columns
  colOrder: { es: "Pedido", en: "Order" },
  colCustomer: { es: "Cliente", en: "Customer" },
  colProducts: { es: "Productos", en: "Products" },
  colTotal: { es: "Total", en: "Total" },
  colPayment: { es: "Pago", en: "Payment" },
  colStatus: { es: "Estado", en: "Status" },
  colDate: { es: "Fecha", en: "Date" },

  // Payment methods
  paymentTransfer: { es: "Transferencia", en: "Transfer" },
  paymentCardOrMp: { es: "Tarjeta / Mercado Pago", en: "Card / Mercado Pago" },

  // Order status badges
  statusCancelled: { es: "Cancelado", en: "Cancelled" },
  statusFailed: { es: "Falló", en: "Failed" },
  statusShipped: { es: "Enviado", en: "Shipped" },
  statusPaid: { es: "Pagado", en: "Paid" },
  statusPendingPayment: { es: "Pendiente de pago", en: "Pending payment" },
} satisfies Namespace;
