import type { Namespace } from "./types";

/**
 * Errores de las rutas de conexión de tiendas (Tiendanube, WooCommerce).
 * Se serializan como `{ error: "..." }` y terminan en un toast del panel,
 * así que van localizados.
 */
export const errStores = {
  // --- comunes ---
  noWorkspace: {
    es: "No se pudo resolver tu espacio de trabajo.",
    en: "Couldn't resolve your workspace.",
  },

  // --- Tiendanube ---
  tiendanubeNotConfigured: {
    es: "La conexión con Tiendanube no está configurada.",
    en: "The Tiendanube connection isn't configured.",
  },

  // --- WooCommerce ---
  invalidSiteUrl: {
    es: "Escribe la dirección de tu tienda, por ejemplo mitienda.com",
    en: "Enter your store address, for example mystore.com",
  },
  wooInvalidKeys: {
    es: "Las claves no son válidas o no tienen permisos de lectura y escritura.",
    en: "The keys are invalid or lack read/write permissions.",
  },
  wooUnreachable: {
    es: "No pudimos conectar con tu tienda. Verifica la dirección y que la API REST esté habilitada.",
    en: "We couldn't reach your store. Check the address and that the REST API is enabled.",
  },
} satisfies Namespace;
