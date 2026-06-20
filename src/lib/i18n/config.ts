/**
 * i18n configuration — single source of truth for supported locales.
 *
 * Riverz ships a custom, lightweight i18n (no routing-based [lang]
 * segments, no heavy library) because the app is overwhelmingly
 * client-rendered (110/144 components are client). The active locale is
 * carried in a cookie (`riverz_locale`) so it is readable BOTH server-side
 * (root layout / the few server components, the proxy IP-default) and
 * client-side (the LocaleProvider), then mirrored to localStorage and,
 * for signed-in users, to `profiles.locale` for cross-device sync.
 *
 * Mirrors the existing theme system (see src/lib/themes.ts) on purpose so
 * the two preference mechanisms read the same way.
 */

export const LOCALES = ["es", "en"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "es";

/** Cookie that carries the locale across server + client. 1 year. */
export const LOCALE_COOKIE = "riverz_locale";

/** Device-scoped mirror so the client can read synchronously before any fetch. */
export const LOCALE_STORAGE_KEY = "riverz.locale";

export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

/** Native names for the language picker (not translated — shown as-is). */
export const LOCALE_NAMES: Record<Locale, string> = {
  es: "Español",
  en: "English",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}
