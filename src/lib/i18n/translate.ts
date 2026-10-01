import type { Locale } from "./config";
import { MESSAGES } from "./messages/registry";
import { translateMessages, type TVars } from './namespace';
export type { TVars, TFn } from './namespace';

/**
 * Resolve a message key for a locale, interpolating `{var}` placeholders.
 * Falls back to the default locale, then to the key itself, so a missing
 * translation degrades visibly instead of crashing.
 */
export function translate(locale: Locale, key: string, vars?: TVars): string {
  return translateMessages(locale, MESSAGES, key, vars);
}
