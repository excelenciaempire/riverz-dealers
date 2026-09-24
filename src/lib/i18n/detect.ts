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

/** Resolve the default locale from request headers (synchronous, no network). */
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

/** Prefer the edge-provided client IP over a potentially client-supplied XFF chain. */
export function clientIp(headers: { get(name: string): string | null }): string | null {
  const edgeIp = headers.get("cf-connecting-ip") || headers.get("true-client-ip");
  if (edgeIp?.trim()) return edgeIp.trim();
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return (
    headers.get("x-real-ip") ||
    null
  );
}

// Skip the geo lookup for these: bots (don't burn the shared lookup quota on
// crawlers) and private/loopback IPs (localhost/dev — they never resolve).
const BOT_UA = /bot|crawl|spider|slurp|crawler|preview|monitor|curl|wget|python-requests|headless|facebookexternalhit|lighthouse/i;
const PRIVATE_IP =
  /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd|fe80:)/i;

/**
 * Resolve a country from the client IP via a free, keyless geolocation
 * endpoint. Used only when the upstream gave us no geo header (e.g. Render,
 * which doesn't set one). Hard 800ms timeout and every failure path returns
 * null, so detection degrades to Accept-Language instead of hanging.
 *
 * At scale, prefer a CDN that sets a country header (Cloudflare's
 * `cf-ipcountry` is already read above) — that's instant and free per request,
 * and short-circuits this network call entirely.
 */
async function countryFromIp(ip: string): Promise<string | null> {
  if (PRIVATE_IP.test(ip)) return null;
  try {
    const res = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/country/`, {
      signal: AbortSignal.timeout(800),
      headers: { "user-agent": "riverz-locale-detect" },
    });
    if (!res.ok) return null;
    const cc = (await res.text()).trim();
    return /^[A-Za-z]{2}$/.test(cc) ? cc.toUpperCase() : null;
  } catch {
    return null;
  }
}

/**
 * Like detectLocale() but adds a real IP→country geolocation step when no geo
 * header is present, so first-time visitors get the right default "por IP"
 * even on hosts (Render) that don't expose a country header. The user can
 * still change it afterwards (onboarding / Settings).
 *
 * Priority: geo header → IP geolocation → Accept-Language → DEFAULT_LOCALE.
 * Only used on the first visit (no locale cookie yet), so the network call
 * happens at most once per visitor.
 */
export async function detectLocaleWithIp(headers: {
  get(name: string): string | null;
}): Promise<Locale> {
  for (const h of GEO_HEADERS) {
    const fromGeo = localeFromGeo(headers.get(h));
    if (fromGeo) return fromGeo;
  }
  const ua = headers.get("user-agent") ?? "";
  if (!BOT_UA.test(ua)) {
    const ip = clientIp(headers);
    if (ip) {
      const fromIp = localeFromGeo(await countryFromIp(ip));
      if (fromIp) return fromIp;
    }
  }
  const fromAccept = localeFromAcceptLanguage(headers.get("accept-language"));
  if (fromAccept) return fromAccept;
  return DEFAULT_LOCALE;
}
