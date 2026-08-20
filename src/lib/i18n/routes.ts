import type { Locale } from "./config";

/**
 * Localized URLs.
 *
 * The Next.js folder names under app/(dashboard) and app/(auth) stay in
 * Spanish — they are the CANONICAL routes and never move, so nothing in the
 * framework breaks. For the English locale we expose English first-segment
 * slugs that are masked back onto the canonical folders by rewrites in
 * next.config.ts (so both /inbox and /bandeja resolve to the same page).
 *
 * Because both forms always resolve, a link that forgets to localize still
 * works — it just shows the Spanish slug until it's wired through
 * localizePath(). That's the safety property behind "without breaking
 * anything".
 *
 * Only the FIRST path segment is translated. Deeper segments (ids, /nueva,
 * /usos…) are preserved verbatim and the rewrite carries them through.
 *
 * Keep the English slugs in sync with the rewrite/redirect map in
 * next.config.ts (this file is the single source the config imports).
 */

/** Canonical (Spanish, = folder) first segment → English slug. */
export const ROUTE_SLUGS_EN: Record<string, string> = {
  // dashboard
  operacion: "operation",
  panel: "dashboard",
  bandeja: "inbox",
  contactos: "contacts",
  asistente: "ai",
  menus: "flows",
  // Llamadas: era el ÚNICO ítem del menú principal sin slug en inglés, así que
  // un usuario en inglés navegaba de /inbox a /voz y la URL cambiaba de idioma
  // sola. Cubre también /voz/campanas, que traduce por el primer segmento.
  voz: "calls",
  "chat-web": "web-chat",
  campanas: "broadcasts",
  automatizaciones: "automations",
  plantillas: "templates",
  "agente-instagram": "instagram-agent",
  comentarios: "comments",
  productos: "products",
  pedidos: "orders",
  metricas: "metrics",
  integraciones: "integrations",
  ajustes: "settings",
  // auth
  ingresar: "login",
  registro: "signup",
  "recuperar-clave": "forgot-password",
  "nueva-clave": "new-password",
  "verificar-email": "verify-email",
  invitacion: "invite",
  // public / legal
  privacidad: "privacy",
  terminos: "terms",
  "eliminar-datos": "data-deletion",
  soporte: "support",
};

/** English slug → canonical (Spanish) first segment. */
export const ROUTE_SLUGS_CANONICAL: Record<string, string> = Object.fromEntries(
  Object.entries(ROUTE_SLUGS_EN).map(([canonical, en]) => [en, canonical]),
);

/** Split a path into its first segment + the remainder + query/hash tail. */
function parse(path: string): { first: string; rest: string; tail: string } {
  // Separate any ?query or #hash so we never translate inside it.
  const tailMatch = path.match(/[?#].*$/);
  const tail = tailMatch ? tailMatch[0] : "";
  const pathname = tail ? path.slice(0, -tail.length) : path;
  const clean = pathname.replace(/^\//, "");
  const slash = clean.indexOf("/");
  const first = slash === -1 ? clean : clean.slice(0, slash);
  const rest = slash === -1 ? "" : clean.slice(slash); // keeps its leading "/"
  return { first, rest, tail };
}

/**
 * Map a canonical (Spanish) path to the given locale. `es` returns it
 * unchanged; `en` swaps the first segment for its English slug when one
 * exists. Non-app paths (/api, /auth/callback, unknown segments) pass
 * through untouched.
 */
export function localizePath(path: string, locale: Locale): string {
  if (locale !== "en" || typeof path !== "string" || !path.startsWith("/"))
    return path;
  const { first, rest, tail } = parse(path);
  const en = ROUTE_SLUGS_EN[first];
  if (!en) return path;
  return `/${en}${rest}${tail}`;
}

/**
 * Map any path (English or Spanish) back to its canonical (Spanish) form.
 * Used by the proxy for auth/route checks and by nav components for
 * active-state matching, so they can reason in one vocabulary regardless of
 * which language the browser URL is in.
 */
export function canonicalizePath(path: string): string {
  if (typeof path !== "string" || !path.startsWith("/")) return path;
  const { first, rest, tail } = parse(path);
  const canonical = ROUTE_SLUGS_CANONICAL[first];
  if (!canonical) return path;
  return `/${canonical}${rest}${tail}`;
}
