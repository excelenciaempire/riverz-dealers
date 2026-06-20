import { DEFAULT_LOCALE, type Locale } from "./config";
import { MESSAGES } from "./messages/registry";

export type TVars = Record<string, string | number>;
export type TFn = (key: string, vars?: TVars) => string;

/**
 * Resolve a message key for a locale, interpolating `{var}` placeholders.
 * Falls back to the default locale, then to the key itself, so a missing
 * translation degrades visibly instead of crashing.
 */
export function translate(locale: Locale, key: string, vars?: TVars): string {
  const entry = MESSAGES[key];
  let str = entry ? (entry[locale] ?? entry[DEFAULT_LOCALE] ?? key) : key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      str = str.split(`{${name}}`).join(String(value));
    }
  }
  return str;
}
