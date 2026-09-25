import type { Namespace } from "./types";

/**
 * Merchant-facing API error/success messages for the products, orders and
 * Shopify route handlers. These strings are serialized as JSON
 * `{ error: "..." }` (or success payloads) and surfaced to the merchant in a
 * dashboard toast, so they must be localized.
 */
export const errProducts = {
  // --- /api/products (POST) ---
  productNameRequired: {
    es: "El nombre del producto es obligatorio.",
    en: "The product name is required.",
  },
  workspaceResolveFailed: {
    es: "No se pudo resolver el workspace.",
    en: "Couldn't resolve the workspace.",
  },

  // --- /api/products/[id]/imagenes (POST) ---
  noPlatformImages: {
    es: "Este producto no tiene fotos en ninguna plataforma conectada.",
    en: "This product has no photos on any connected platform.",
  },

  // --- /api/products/[id]/agents (POST, DELETE) ---
  agentIdRequired: {
    es: "agent_id es requerido",
    en: "agent_id is required",
  },
  agentIdQueryParamRequired: {
    es: "agent_id query param requerido",
    en: "agent_id query param is required",
  },
  productNotFound: {
    es: "Producto no encontrado",
    en: "Product not found",
  },
  agentNotFound: {
    es: "Agente no encontrado",
    en: "Agent not found",
  },

  // --- /api/products/[id]/ai-research (POST) ---
  anthropicKeyMissing: {
    es: "ANTHROPIC_API_KEY no configurada en el servidor",
    en: "ANTHROPIC_API_KEY is not configured on the server",
  },
  researchFailed: {
    es: "No se pudo generar la investigación",
    en: "Couldn't generate the research",
  },

  // --- /api/products/[id]/scrape (POST) ---
  productNoPublicUrl: {
    es: "El producto no tiene una URL pública válida",
    en: "The product doesn't have a valid public URL",
  },
  scrapeFailed: {
    es: "No se pudo leer la página",
    en: "Couldn't read the page",
  },

  // --- /api/products/sync (POST) ---
  noActiveShopifyConnection: {
    es: "No hay una conexión Shopify activa. Conecta Shopify desde Integraciones primero.",
    en: "There's no active Shopify connection. Connect Shopify from Integrations first.",
  },
  shopifyConnectionMissingCredentials: {
    es: "La conexión Shopify no tiene shop_domain o access_token",
    en: "The Shopify connection is missing shop_domain or access_token",
  },
  userNoWorkspace: {
    es: "El usuario no tiene un workspace asignado",
    en: "The user doesn't have an assigned workspace",
  },

  // --- /api/orders (GET) ---
  notAuthenticated: {
    es: "No autenticado",
    en: "Not authenticated",
  },
  noWorkspace: {
    es: "Sin workspace",
    en: "No workspace",
  },
  ordersLoadFailed: {
    es: "No se pudieron cargar los pedidos",
    en: "Couldn't load the orders",
  },

  // --- /api/shopify/customer (GET) ---
  emailOrPhoneRequired: {
    es: "email o phone requerido",
    en: "email or phone is required",
  },

  // --- /api/shopify/products/sync (POST) ---
  noShopifyStoreConnected: {
    es: "No hay tienda Shopify conectada.",
    en: "There's no Shopify store connected.",
  },
  shopifyConnectionNotFound: {
    es: "Conexión no encontrada",
    en: "Connection not found",
  },
  shopifySyncFailed: {
    es: "No se pudo sincronizar",
    en: "Couldn't sync",
  },

  // --- /api/products/[id] (PATCH) ---
  customFaqsMustBeArray: {
    es: "custom_faqs debe ser un array",
    en: "custom_faqs must be an array",
  },
  customFaqInvalidShape: {
    es: "Cada FAQ debe tener q y a como string",
    en: "Each FAQ must have q and a as strings",
  },

  // --- /api/shopify/oauth/start, /api/shopify/install ---
  shopifyNotConfigured: {
    es: "Shopify no está configurado (falta SHOPIFY_API_KEY).",
    en: "Shopify isn't configured (SHOPIFY_API_KEY is missing).",
  },
  invalidShopDomain: {
    es: "Dominio de tienda no válido (debe ser *.myshopify.com).",
    en: "Invalid store domain (must be *.myshopify.com).",
  },
  noWorkspaceForUser: {
    es: "No se encontró un workspace para tu usuario.",
    en: "No workspace was found for your user.",
  },

  // --- /api/shopify/connect-client-credentials (app del Dev Dashboard) ---
  shopifyMissingCredentialFields: {
    es: "Faltan datos: dominio, Client ID y Client secret.",
    en: "Missing fields: store domain, Client ID and Client secret.",
  },
  shopifyAppNotInstalled: {
    es: "La app no está instalada en esa tienda. Instálala desde el Dev Dashboard de la tienda y vuelve a conectar.",
    en: "The app isn't installed on that store. Install it from the store's Dev Dashboard and connect again.",
  },
  shopifyCredentialsInvalid: {
    es: "Shopify rechazó las credenciales. Revisa el dominio, el Client ID y el Client secret.",
    en: "Shopify rejected the credentials. Check the domain, Client ID and Client secret.",
  },
  shopifyConnectFailed: {
    es: "No se pudo guardar la conexión. Intenta de nuevo.",
    en: "Couldn't save the connection. Try again.",
  },
  // --- /api/shopify/claim (App Store install-first flow) ---
  shopifyClaimExpired: {
    es: "La instalación de Shopify expiró. Vuelve a abrir Riverz desde tu admin de Shopify.",
    en: "The Shopify install expired. Open Riverz again from your Shopify admin.",
  },
  shopifyClaimFailed: {
    es: "No se pudo conectar la tienda. Intenta de nuevo desde tu admin de Shopify.",
    en: "Couldn't connect the store. Try again from your Shopify admin.",
  },
} satisfies Namespace;
