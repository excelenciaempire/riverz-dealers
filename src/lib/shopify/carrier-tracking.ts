/**
 * Resolve a public tracking URL for regional carriers that Shopify does
 * NOT auto-populate. Shopify's `tracking_url` is only filled when the
 * carrier is in its built-in list (UPS, FedEx, DHL, USPS, Canada Post,
 * etc). For "Other" / free-text carriers the URL is null and the
 * customer ends up with a bare tracking number to paste somewhere.
 *
 * Two origins for that free-text carrier name today:
 *  - Argentina: the merchant fulfils by hand and types the carrier.
 *  - Colombia: Dropi writes the guide back into Shopify on
 *    GUIA_GENERADA (number + carrier, confirmed with Dropi support
 *    2026-08-27), always as free text — so `tracking_url` is always
 *    null for COD orders and this resolver is the only source.
 *
 * Add more as merchants surface them; verify each URL against the live
 * tracker before merging (these are SPAs and their routes drift). When
 * a deep link is not verified, return the tracker entrypoint instead of
 * a half-broken URL — same rule OCA follows below.
 */

type CarrierResolver = {
  /** Substrings (already lowercased) used to detect this carrier in
   *  Shopify's free-text tracking_company. Match via .includes(). */
  patterns: string[]
  /** Returns the tracking URL for a given number, or null if the
   *  carrier requires a step (login, form post) we can't shortcut. */
  build: (number: string) => string | null
}

const CARRIERS: CarrierResolver[] = [
  {
    patterns: ['andreani'],
    // Andreani's tracker is a SPA that accepts the number as the
    // anchor route — pasting the URL drops the customer directly
    // on the result page.
    build: (n) => `https://www.andreani.com/#!/informacionEnvio/${encodeURIComponent(n)}`,
  },
  {
    patterns: ['correo argentino', 'correoargentino', 'correo arg', 'correo-argentino'],
    // Correo Argentino's public tracker only accepts the code as a
    // query param on the e-commerce form page. Confirmed against
    // https://www.correoargentino.com.ar/ tracker UI.
    build: (n) => `https://www.correoargentino.com.ar/formularios/ondnc?id=${encodeURIComponent(n)}`,
  },
  {
    patterns: ['oca'],
    // OCA does not have a permalink that accepts the number as a path
    // segment — return the public tracker entrypoint instead of a
    // half-broken URL.
    build: () => 'https://www.oca.com.ar/Envios',
  },

  // --- Colombia (Dropi) -------------------------------------------------
  // Dropi writes these names as free text, so casing and accents vary
  // between accounts; every pattern below is matched unaccented AND
  // accented. None of the deep links are verified yet, so all return the
  // public tracker entrypoint — the customer still lands on the right
  // carrier instead of googling the name. Upgrade each to a real deep
  // link once a live guide confirms the query param.
  {
    patterns: ['interrapidisimo', 'interrapidísimo', 'inter rapidisimo', 'inter rapidísimo'],
    build: () => 'https://interrapidisimo.com/sigue-tu-envio/',
  },
  {
    patterns: ['servientrega'],
    build: () => 'https://www.servientrega.com/wps/portal/rastreo-envio',
  },
  {
    patterns: ['coordinadora'],
    build: () => 'https://coordinadora.com/rastreo/rastreo-de-guia/',
  },
  {
    patterns: ['deprisa'],
    build: () => 'https://www.deprisa.com/Seguimiento',
  },
  // Short/generic patterns go last: the loop returns on first match, so
  // 'tcc' and 'envia' must never shadow a more specific carrier above.
  {
    patterns: ['tcc'],
    build: () => 'https://tcc.com.co/rastrea-tu-envio/',
  },
  {
    patterns: ['envia', 'envía'],
    build: () => 'https://envia.co/',
  },
]

/**
 * Resolve a carrier+number pair to a public tracking URL. Returns null
 * when carrier or number is missing or unknown; the caller should
 * fall back to whatever Shopify gave (which is also often null).
 */
export function resolveCarrierTrackingUrl(
  carrier: string | null | undefined,
  number: string | null | undefined,
): string | null {
  const c = (carrier ?? '').trim().toLowerCase()
  const n = (number ?? '').trim()
  if (!c || !n) return null
  for (const resolver of CARRIERS) {
    if (resolver.patterns.some((p) => c.includes(p))) {
      return resolver.build(n)
    }
  }
  return null
}
