import type { TFn } from "@/lib/i18n/translate";

export interface ContactLike {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  channel?: string | null;
  external_id?: string | null;
}

/**
 * Etiqueta de display para un contacto, con fallback por canal cuando no hay
 * nombre real. Meta (IG/Messenger) y Mercado Libre no exponen el nombre real
 * hasta que se resuelve en segundo plano, así que sin esto un contacto recién
 * creado se mostraba como "null". Espeja la lógica de resolveDisplayName del
 * inbox para que la etiqueta sea idéntica en toda la app (bandeja, panel, etc.).
 */
export function contactLabel(t: TFn, c: ContactLike): string {
  if (c.name) return c.name;
  if (c.email) return c.email;
  if (c.phone) return c.phone;
  const ext = c.external_id;
  if (ext) {
    if (c.channel === "instagram") return t("inbox.instagramCustomer", { id: ext.slice(-5) });
    if (c.channel === "messenger") return t("inbox.messengerCustomer", { id: ext.slice(-5) });
    if (c.channel === "mercadolibre")
      return t("inbox.mercadolibreCustomer", { id: ext.slice(-5) });
    return ext;
  }
  return t("inbox.noName");
}
