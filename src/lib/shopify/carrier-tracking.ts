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
  /** Nombre corto que se muestra al cliente. */
  displayName: string
  /** Substrings (already lowercased) used to detect this carrier in
   *  Shopify's free-text tracking_company. Match via .includes(). */
  patterns: string[]
  /** Returns the tracking URL for a given number, or null if the
   *  carrier requires a step (login, form post) we can't shortcut. */
  build: (number: string) => string | null
}

const CARRIERS: CarrierResolver[] = [
  {
    displayName: 'Andreani',
    patterns: ['andreani'],
    // Andreani's tracker is a SPA that accepts the number as the
    // anchor route — pasting the URL drops the customer directly
    // on the result page.
    build: (n) => `https://www.andreani.com/#!/informacionEnvio/${encodeURIComponent(n)}`,
  },
  {
    displayName: 'Correo Argentino',
    patterns: ['correo argentino', 'correoargentino', 'correo arg', 'correo-argentino'],
    // Correo Argentino's public tracker only accepts the code as a
    // query param on the e-commerce form page. Confirmed against
    // https://www.correoargentino.com.ar/ tracker UI.
    build: (n) => `https://www.correoargentino.com.ar/formularios/ondnc?id=${encodeURIComponent(n)}`,
  },
  {
    displayName: 'OCA',
    patterns: ['oca'],
    // OCA does not have a permalink that accepts the number as a path
    // segment — return the public tracker entrypoint instead of a
    // half-broken URL.
    build: () => 'https://www.oca.com.ar/Envios',
  },

  // --- Colombia (Dropi) -------------------------------------------------
  // Dropi writes these names as free text, so casing and accents vary
  // between accounts; every pattern below is matched unaccented AND
  // accented. Where a carrier exposes a verified deep link, include the guide;
  // otherwise return its public tracker entrypoint instead of guessing params.
  {
    displayName: 'Inter Rapidísimo',
    patterns: ['interrapidisimo', 'interrapidísimo', 'inter rapidisimo', 'inter rapidísimo'],
    build: () => 'https://interrapidisimo.com/sigue-tu-envio/',
  },
  {
    displayName: 'Servientrega',
    patterns: ['servientrega'],
    build: () => 'https://www.servientrega.com/wps/portal/rastreo-envio',
  },
  {
    displayName: 'Coordinadora',
    patterns: ['coordinadora'],
    // URL oficial documentada por Coordinadora. A diferencia del portal
    // anterior, este deep-link conserva la guía para que Pilar y el cliente
    // no tengan que copiarla manualmente al abrir el rastreo.
    build: (n) => `https://rastreo.coordinadora.com/?guia=${encodeURIComponent(n)}`,
  },
  {
    displayName: 'Deprisa',
    patterns: ['deprisa'],
    build: () => 'https://www.deprisa.com/Seguimiento',
  },
  // Short/generic patterns go last: the loop returns on first match, so
  // 'tcc' and 'envia' must never shadow a more specific carrier above.
  {
    displayName: 'TCC',
    patterns: ['tcc'],
    build: () => 'https://tcc.com.co/rastrea-tu-envio/',
  },
  {
    displayName: 'Envía',
    patterns: ['envia', 'envía'],
    // El rastreador público de Envía acepta la guía en la URL y abre el
    // detalle de ese envío. No usar envia.co/?guia=...: esa página conserva
    // el parámetro, pero deja al cliente en el formulario general.
    build: (n) => `https://hub.envia.co/landingrastreo/Rastreo/Index?guia=${encodeURIComponent(n)}`,
  },
]

/** Los nombres que ya sabemos rastrear, para sugerirlos al cargar una guía. */
export const KNOWN_CARRIER_NAMES: readonly string[] = CARRIERS.map((c) => c.displayName)

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

/**
 * Normaliza el nombre libre que llega de Shopify/Dropi para presentarlo en
 * mensajes. Conserva transportadoras desconocidas y devuelve un valor seguro
 * cuando Shopify no informa el nombre, evitando que Meta rechace la plantilla
 * por una variable vacía.
 */
export function displayCarrierName(carrier: string | null | undefined): string {
  const raw = (carrier ?? '').trim()
  const normalized = raw.toLowerCase()
  if (!normalized) return 'Transportadora asignada'
  const known = CARRIERS.find((resolver) =>
    resolver.patterns.some((pattern) => normalized.includes(pattern)),
  )
  return known?.displayName ?? raw
}
