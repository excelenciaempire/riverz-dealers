import { DEFAULT_LOCALE, isLocale, LOCALES, type Locale } from "./config";

/**
 * Best-effort default-locale detection for a first-time visitor (no
 * locale cookie yet). Used by the proxy. Edge-safe: no Node APIs, no deps.
 *
 * Priority:
 *  1. An explicit geo/country header (set by the upstream CDN/proxy, e.g.
 *     Cloudflare `cf-ipcountry`, Vercel `x-vercel-ip-country`). If the
 *     visitor is in a primarily Spanish-speaking country → "es", otherwise
 *     → "en". This is the "por IP" rule the product wants.
 *  2. The `Accept-Language` header (the browser's own language order) as a
 *     fallback when no geo header is present.
 *  3. DEFAULT_LOCALE ("es").
 *
 * The user can always override the result in onboarding or in Settings.
 */

// Country codes (ISO 3166-1 alpha-2) where Spanish is the primary language.
const SPANISH_COUNTRIES = new Set([
  "ES", "MX", "AR", "CO", "PE", "VE", "CL", "EC", "GT", "CU", "BO", "DO",
  "HN", "PY", "SV", "NI", "CR", "PA", "UY", "PR", "GQ",
]);

const GEO_HEADERS = [
  "cf-ipcountry",
  "x-vercel-ip-country",
  "x-geo-country",
  "x-country-code",
];

export function localeFromGeo(country: string | null | undefined): Locale | null {
  if (!country) return null;
  const cc = country.trim().toUpperCase();
  if (cc.length !== 2 || cc === "XX") return null;
  return SPANISH_COUNTRIES.has(cc) ? "es" : "en";
}

export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  // Parse "en-US,en;q=0.9,es;q=0.8" into ordered base languages by q-weight.
  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      const weight = q ? parseFloat(q.split("=")[1]) : 1;
      return { lang: tag.trim().toLowerCase().split("-")[0], q: Number.isFinite(weight) ? weight : 0 };
    })
    .filter((r) => r.lang)
    .sort((a, b) => b.q - a.q);
  for (const { lang } of ranked) {
    if (isLocale(lang) && (LOCALES as readonly string[]).includes(lang)) return lang as Locale;
  }
  return null;
}

/** Resolve the default locale from request headers. */
export function detectLocale(headers: {
  get(name: string): string | null;
}): Locale {
  for (const h of GEO_HEADERS) {
    const fromGeo = localeFromGeo(headers.get(h));
    if (fromGeo) return fromGeo;
  }
  const fromAccept = localeFromAcceptLanguage(headers.get("accept-language"));
  if (fromAccept) return fromAccept;
  return DEFAULT_LOCALE;
}
