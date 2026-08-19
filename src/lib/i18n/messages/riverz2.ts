import type { Namespace } from "./types";

/**
 * Riverz 2.0 — el chrome de la aplicación conversacional.
 *
 * Sólo lo del shell: las pestañas y lo que las rodea. Lo del chat y el centro
 * de control vive en el namespace `operation`.
 */
export const riverz2 = {
  tabChat: { es: "Chat", en: "Chat" },
  tabPanel: { es: "Panel", en: "Panel" },
  tabInbox: { es: "Bandeja", en: "Inbox" },
  tabEdit: { es: "Editar", en: "Edit" },
  tabSettings: { es: "Ajustes", en: "Settings" },
} satisfies Namespace;
