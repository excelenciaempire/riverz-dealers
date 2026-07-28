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
  wooNotWordpress: {
    es: "Esa dirección no tiene WordPress. Escribe la dirección de la tienda, no la de tu web principal.",
    en: "That address isn't running WordPress. Enter your store's address, not your main website.",
  },
  wooNoWoocommerce: {
    es: "El sitio tiene WordPress pero WooCommerce no está activo. Actívalo y vuelve a intentar.",
    en: "The site runs WordPress but WooCommerce isn't active. Activate it and try again.",
  },
  wooPlainPermalinks: {
    es: "En tu WordPress, entra a Ajustes → Enlaces permanentes y elige cualquier opción que no sea «Simple». Después vuelve a intentar.",
    en: "In your WordPress, go to Settings → Permalinks and pick any option other than “Plain”. Then try again.",
  },
} satisfies Namespace;
