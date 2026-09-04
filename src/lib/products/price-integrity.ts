import { parseMoney } from '@/lib/shopify/detect-offers'

export interface PriceProduct {
  price_min?: number | null
  price_max?: number | null
  allowed_offers?: unknown
}

const PRICE_INTENT =
  /\b(precio|precios|cu[aá]nto\s+(?:sale|cuesta|vale)|valor|price|prices|how\s+much|cost)\b/i

export function asksForPrice(text: string | null | undefined): boolean {
  return PRICE_INTENT.test(text ?? '')
}

/**
 * El material scrapeado es conocimiento útil, pero no es un tarifario: puede
 * tener una oferta de ayer. Los precios se inyectan por separado desde la
 * verificación viva, así que se quitan aquí todas las líneas monetarias para
 * que el modelo no tenga dos verdades incompatibles en el mismo prompt.
 */
export function withoutHistoricalPriceLines(text: string | null | undefined): string {
  return (text ?? '')
    .split(/\r?\n/)
    .filter(
      (line) =>
        !/\b(precio|precios|price|prices|oferta|ofertas|promo|promoci[oó]n)\b/i.test(line) &&
        !/(?:AR\$|US\$|\$|ARS|USD|COP|CLP|MXN|BRL|PEN|EUR)\s*\d/i.test(line) &&
        !/\d\s*(?:ARS|USD|COP|CLP|MXN|BRL|PEN|EUR|pesos?|d[oó]lares?|reales?|soles?)\b/i.test(
          line,
        ),
    )
    .join('\n')
    .trim()
}

function addMoney(into: Set<number>, raw: unknown) {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    into.add(raw)
    return
  }
  if (typeof raw !== 'string' || !raw.trim()) return
  const parsed = parseMoney(raw)
  if (parsed != null && parsed > 0) into.add(parsed)
}

/** Los únicos importes que el agente puede presentar como precio de venta. */
export function authorizedPrices(products: PriceProduct[]): number[] {
  const values = new Set<number>()
  for (const product of products) {
    addMoney(values, product.price_min)
    addMoney(values, product.price_max)
    if (!Array.isArray(product.allowed_offers)) continue
    for (const offer of product.allowed_offers) {
      if (offer && typeof offer === 'object') {
        addMoney(values, (offer as Record<string, unknown>).total)
      }
    }
  }
  return [...values]
}

function quotedAmounts(text: string, includeBare: boolean): number[] {
  const matches: string[] = []
  const explicit =
    /(?:AR\$|US\$|\$|ARS|USD|COP|CLP|MXN|BRL|PEN|EUR)\s*\d[\d.,\s]*|\d[\d.,\s]*\s*(?:ARS|USD|COP|CLP|MXN|BRL|PEN|EUR|pesos?|d[oó]lares?|reales?|soles?)/gi
  for (const match of text.matchAll(explicit)) matches.push(match[0])

  // En una respuesta a “¿Precio?” también se bloquean cifras desnudas como
  // “990 una unidad. 900. 900.”: fue exactamente el comentario roto que motivó
  // esta guarda. Sólo 3+ dígitos para no confundir “3 unidades” con dinero.
  if (includeBare) {
    for (const match of text.matchAll(/(?<![\p{L}\p{N}%])\d{3,}(?:[.,]\d{3})*(?![\p{L}\p{N}%])/gu)) {
      matches.push(match[0])
    }
  }

  const values = new Set<number>()
  for (const raw of matches) {
    const parsed = parseMoney(raw)
    if (parsed != null && parsed > 0) values.add(parsed)
  }
  return [...values]
}

/**
 * Devuelve los montos que el modelo intentó cotizar sin respaldo. Vacío = se
 * puede publicar. Esto corre DESPUÉS del modelo y antes de tocar el canal.
 */
export function unauthorizedQuotedPrices(
  response: string,
  productsOrPrices: PriceProduct[] | number[],
  opts?: { priceQuestion?: boolean },
): number[] {
  const allowed = new Set(
    (typeof productsOrPrices[0] === 'number'
      ? (productsOrPrices as number[])
      : authorizedPrices(productsOrPrices as PriceProduct[])
    ).map(Number),
  )
  const quoted = quotedAmounts(response, opts?.priceQuestion === true)
  return quoted.filter(
    (amount) => ![...allowed].some((valid) => Math.abs(valid - amount) < 0.01),
  )
}

/**
 * Una pregunta de precio sin producto identificado no autoriza a citar
 * importes: el catálogo puede tener varias referencias y una cifra adivinada
 * es peor que pedir la precisión mínima. Esta salida reemplaza únicamente una
 * propuesta del modelo que ya intentó cotizar un valor sin verificar.
 */
export function replyForUnidentifiedPrice(
  language: string | null | undefined,
  productUrls: Array<string | null | undefined>,
): string {
  const storeUrl = productUrls.find((url) => {
    if (!url) return false
    try {
      const parsed = new URL(url)
      return parsed.protocol === 'https:' || parsed.protocol === 'http:'
    } catch {
      return false
    }
  })

  let catalogUrl: string | null = null
  if (storeUrl) {
    try {
      catalogUrl = new URL(storeUrl).origin
    } catch {
      catalogUrl = null
    }
  }

  const lang = (language ?? 'es').toLowerCase().slice(0, 2)
  if (lang === 'en') {
    return `We have several models with different prices. Tell me which scratcher you mean and I’ll share the exact current price.${catalogUrl ? ` You can also browse the catalog here: ${catalogUrl}` : ''}`
  }
  if (lang === 'pt') {
    return `Temos vários modelos com preços diferentes. Diga qual arranhador você quer e eu confirmo o preço atual exato.${catalogUrl ? ` Você também pode ver o catálogo aqui: ${catalogUrl}` : ''}`
  }
  return `Tenemos varios modelos con precios diferentes. Dime cuál rascador te interesa y te comparto el precio vigente exacto.${catalogUrl ? ` También puedes ver el catálogo aquí: ${catalogUrl}` : ''}`
}
