import { DEFAULT_LOCALE, type Locale } from './config';
import type { Namespace } from './messages/types';
export type TVars = Record<string, string | number>;
export type TFn = (key: string, vars?: TVars) => string;

/** Resolve a bounded catalog without importing the app/admin registry into
 * a public surface such as the store widget. */
export function translateMessages(locale: Locale, messages: Namespace, key: string, vars?: TVars): string {
  const entry = messages[key];
  let str = entry ? (entry[locale] ?? entry[DEFAULT_LOCALE] ?? key) : key;
  if (vars) for (const [name, value] of Object.entries(vars)) str = str.split(`{${name}}`).join(String(value));
  return str;
}
