import type { Locale } from "../config";

/**
 * A single translatable string, with one value per supported locale.
 * Both locales are required so a missing translation is a type error,
 * not a silent runtime fallback.
 */
export type MessageEntry = Record<Locale, string>;

/**
 * A namespace groups the strings of one feature area (e.g. "inbox",
 * "settings"). Each translation agent owns ONE namespace file shaped like
 * this and never edits shared files, so parallel work never conflicts.
 *
 *   export const inbox = {
 *     send: { es: "Enviar", en: "Send" },
 *     placeholder: { es: "Escribe un mensaje", en: "Type a message" },
 *   } satisfies Namespace;
 */
export type Namespace = Record<string, MessageEntry>;
