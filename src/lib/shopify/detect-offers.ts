/**
 * Generic offer/bundle detection.
 *
 * The merchant's per-product "Precios" (allowed_offers) drives the whole
 * per-buyer "which offer / how many units did they choose" chain:
 * `resolveOfferChosen` (src/lib/shopify/offers.ts) matches an order's TOTAL
 * units against `allowed_offers[].units`, and the AI runner injects the
 * offer list live into the system prompt. Today those offers are typed by
 * hand. This module detects them automatically so a merchant configures
 * almost nothing.
 *
 * Deliberately GENERIC — not tied to any one bundle app. Many stores use
 * Kaching Bundles, ReConvert, Zipify, Honeycomb, etc.; many use none. Two
 * source parsers, plus normalization:
 *
 *   - `offersFromText`  — parse tiers from a scraped product page
 *     (markdown/HTML text). This is the primary path: the widget rows
 *     ("2 Unidades + 1 GRATIS", "3-pack", "Buy 2 get 1 free") render as
 *     plain text regardless of which app drew them.
 *   - `offersFromOrderProperties` — learn tiers from real orders that carry
 *     the Kaching `__kaching_bundles` line-item property (purchase-confirmed;
 *     used by the Shopify backfill). App-specific but zero-cost.
 *
 * The ONLY field that strictly matters for matching is `units` (an integer =
 * paid + free). `label`/`total` are for display/segmentation, so price is
 * best-effort — a missing price is fine, a wrong one is worse.
 */

export interface DetectedOffer {
  /** Human label in the merchant's language (verbatim from the page when possible). */
  label: string
  /** Total units the buyer receives = paid + free. The match key. */
  units: number
  /** Tier price, numeric, if we could parse one confidently. */
  total?: number
}

/**
 * Parse a money string into a number, tolerating both `1.234,56` (es/LatAm)
 * and `1,234.56` (en) grouping, plus lone-dot thousands (`39.990` → 39990).
 * Mirrors the `offerPrice` helper in the products PATCH route.
 */
export function parseMoney(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : null
  if (typeof raw !== 'string') return null
  const cleaned = raw.replace(/[^\d.,]/g, '')
  if (!cleaned) return null

  const hasComma = cleaned.includes(',')
  const hasDot = cleaned.includes('.')
  let norm = cleaned
  if (hasComma && hasDot) {
    // Whichever separator comes last is the decimal separator.
    norm =
      cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')
        ? cleaned.replace(/\./g, '').replace(',', '.')
        : cleaned.replace(/,/g, '')
  } else if (hasComma) {
    // Lone comma → decimal only when it's a trailing ,dd; otherwise thousands.
    norm = /,\d{1,2}$/.test(cleaned) ? cleaned.replace(',', '.') : cleaned.replace(/,/g, '')
  } else if (hasDot) {
    // Lone dot(s) → thousands when there are multiple dots or a 3-digit group
    // ("39.990", "1.299.500"); otherwise a real decimal ("39.99").
    const dots = (cleaned.match(/\./g) ?? []).length
    if (dots > 1 || /\.\d{3}\b/.test(cleaned)) norm = cleaned.replace(/\./g, '')
  }
  const n = Number(norm)
  return Number.isFinite(n) && n > 0 ? n : null
}

// A pricing tier: a count immediately followed by a unit word, optionally
// "+ N gratis/free". Case-insensitive, es + en (+ common LatAm variants).
// NON-global on purpose so `.test`/`.exec` stay stateless.
const TIER_RE =
  /(\d{1,3})\s*(?:unidad(?:es)?|unit(?:s)?|piezas?|pzas?|pcs?|uds?|pack(?:s)?|combos?|kits?|paquetes?)\.?(?:\s*(?:\+|y|más|mas|and|con)\s*(\d{1,3})\s*(?:gratis|de\s*regalo|free|gift|regalo))?/i

// Fallback for "pack/combo de N" phrasing (number AFTER the noun).
const PACK_DE_RE = /(?:pack|combo|kit|paquete|caja|bundle|set)\s+de\s+(\d{1,3})/i

// A monetary token: optional currency symbol/code, then a number that carries
// a grouping or decimal separator (so bare "2"/"1" from the tier don't match).
const MONEY_RE = /(?:[$€£]|USD|COP|ARS|MXN|CLP|PEN|EUR|BRL)?\s?\d[\d.,]*\d/gi

function extractMoney(text: string): number[] {
  const out: number[] = []
  const matches = text.match(MONEY_RE) ?? []
  for (const tok of matches) {
    // Require a currency symbol/code OR an internal separator to qualify as
    // money — filters out standalone counts.
    if (!/[$€£]/.test(tok) && !/[A-Za-z]/.test(tok) && !/\d[.,]\d/.test(tok)) continue
    const n = parseMoney(tok)
    if (n != null) out.push(n)
  }
  return out
}

function cleanLabel(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/**
 * Parse offer tiers from a scraped product page (markdown or plain text).
 * Works line-by-line; for the price of a tier it scans the tier's line plus
 * the next couple of lines (bundle "cards" often split label/savings/price
 * across lines) and takes the LOWEST money token — the sale price, not the
 * struck compare-at or the savings amount.
 */
export function offersFromText(text: string): DetectedOffer[] {
  if (!text || typeof text !== 'string') return []
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  const out: DetectedOffer[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const m = TIER_RE.exec(line)
    let paid: number | null = null
    let free = 0
    let phrase = ''
    if (m) {
      paid = parseInt(m[1], 10)
      free = m[2] ? parseInt(m[2], 10) : 0
      phrase = m[0]
    } else {
      const pm = PACK_DE_RE.exec(line)
      if (pm) {
        paid = parseInt(pm[1], 10)
        phrase = pm[0]
      }
    }
    if (paid == null || !Number.isFinite(paid) || paid <= 0 || paid > 99) continue
    if (!Number.isFinite(free) || free < 0 || free > 99) free = 0
    const units = paid + free

    // Gather price candidates from this line + up to 2 following lines that
    // aren't themselves another tier (a single card).
    const scan = [line.replace(phrase, ' ')]
    for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
      if (TIER_RE.test(lines[j]) || PACK_DE_RE.test(lines[j])) break
      scan.push(lines[j])
    }
    const prices = extractMoney(scan.join(' '))
    const total = prices.length ? Math.min(...prices) : undefined

    out.push({ label: cleanLabel(phrase), units, total })
  }
  return out
}

/** Extract a balanced `[...]`/`{...}` span starting at `start`, honoring JSON strings. */
export function extractBalanced(s: string, start: number, open: string, close: string): string | null {
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
    } else if (c === '"') inStr = true
    else if (c === open) depth++
    else if (c === close) {
      depth--
      if (depth === 0) return s.slice(start, i + 1)
    }
  }
  return null
}

/**
 * Parse offer tiers from a bundle app's config embedded in the page (Kaching
 * ships its `dealBars` config as JSON in the product page — deterministic and
 * available even without JS rendering, unlike the visible widget text). Each
 * bar carries a `title` (label) + `quantity`/`dealBarType`; total units follow
 * the same rule as everywhere: quantity-break → quantity, bxgy → buy + get.
 */
export function offersFromKachingConfig(text: string): DetectedOffer[] {
  if (!text || typeof text !== 'string') return []
  const out: DetectedOffer[] = []
  const KEY = '"dealBars"'
  let idx = 0
  while (true) {
    const k = text.indexOf(KEY, idx)
    if (k < 0) break
    const br = text.indexOf('[', k)
    idx = k + KEY.length
    if (br < 0) continue
    const arr = extractBalanced(text, br, '[', ']')
    if (!arr) continue
    let bars: unknown
    try {
      bars = JSON.parse(arr)
    } catch {
      continue
    }
    if (!Array.isArray(bars)) continue
    for (const bar of bars) {
      const b = bar as Record<string, unknown>
      const type = String(b?.dealBarType ?? '')
      const title = typeof b?.title === 'string' ? b.title.trim() : ''
      const units =
        type === 'bxgy'
          ? (Number(b?.buyQuantity) || 0) + (Number(b?.getQuantity) || 0)
          : Number(b?.quantity) || 0
      // En los descuentos de monto fijo, Kaching guarda el TOTAL que se cobra
      // en `discountValue`. Antes ignorábamos ese campo y dependíamos del texto
      // visible que Firecrawl hubiera alcanzado a renderizar. Cuando el
      // comercio cambiaba 99.900 por 109.990, la estructura nueva ya estaba en
      // el HTML pero Riverz conservaba el precio viejo del scrape anterior.
      const discountType = String(b?.discountType ?? '')
      const discountValue = Number(b?.discountValue)
      const total =
        discountType === 'specific' && Number.isFinite(discountValue) && discountValue > 0
          ? discountValue
          : undefined
      if (units > 0) out.push({ label: title, units, total })
    }
  }
  return out
}

/**
 * Detect offers from scraped product content: the embedded bundle config in the
 * raw HTML (most reliable — structured, render-independent) plus the visible
 * "X Unidades + Y GRATIS" widget text from the markdown, deduped + normalized.
 * Config tiers are listed first so their clean labels win on a units tie; the
 * markdown text contributes prices. Pass config parsing only the HTML (config
 * lives in a script) and text parsing only the markdown (avoids HTML noise).
 */
export function detectOffers(
  markdown: string,
  html?: string | null,
  locale: 'es' | 'en' = 'es',
): DetectedOffer[] {
  return normalizeDetectedOffers(
    [...offersFromKachingConfig(html ?? ''), ...offersFromText(markdown ?? '')],
    locale,
  )
}

interface RawLineItem {
  quantity?: number | string
  properties?: unknown
  product_id?: number | string
}

function readProperty(properties: unknown, name: string): string | null {
  // Shopify order line-item properties can arrive as an array of {name,value}
  // or (rarely) an object map. Support both.
  if (Array.isArray(properties)) {
    for (const p of properties) {
      const pr = p as { name?: unknown; value?: unknown }
      if (typeof pr?.name === 'string' && pr.name === name) {
        return pr.value == null ? null : String(pr.value)
      }
    }
    return null
  }
  if (properties && typeof properties === 'object') {
    const v = (properties as Record<string, unknown>)[name]
    return v == null ? null : String(v)
  }
  return null
}

/**
 * Learn offer tiers from a real Shopify order that carries Kaching's
 * `__kaching_bundles` line-item property (value like {"deal":"u1sI",...}).
 * Line items sharing the same "deal" code = one offer; we sum their
 * quantities → the total units the buyer received. Purchase-confirmed, and
 * it handles BXGY natively (the free $0.00 line is a real line item whose
 * quantity is already in the sum).
 */
export function offersFromOrderProperties(order: unknown): DetectedOffer[] {
  const lineItems = Array.isArray((order as { line_items?: unknown })?.line_items)
    ? ((order as { line_items: RawLineItem[] }).line_items)
    : []
  const byDeal = new Map<string, number>()
  for (const li of lineItems) {
    const raw = readProperty(li?.properties, '__kaching_bundles')
    if (!raw) continue
    let deal = ''
    try {
      const parsed = JSON.parse(raw) as { deal?: unknown }
      deal = typeof parsed?.deal === 'string' ? parsed.deal : ''
    } catch {
      // Value wasn't JSON — fall back to the raw string as the group key.
      deal = raw
    }
    if (!deal) continue
    const qty = Number(li?.quantity) || 0
    byDeal.set(deal, (byDeal.get(deal) ?? 0) + qty)
  }
  const out: DetectedOffer[] = []
  for (const units of byDeal.values()) {
    if (units > 0) out.push({ label: '', units })
  }
  return out
}

/**
 * Like `offersFromOrderProperties`, but attributes each learned tier to the
 * PRODUCT(s) it involves, so the backfill / connect-time learner can write
 * tiers onto the right `shopify_products` rows. Returns one `{productId,
 * units}` per (product, distinct deal-total) seen in the order.
 */
export function offersByProductFromOrder(
  order: unknown,
): Array<{ productId: string; units: number }> {
  const lineItems = Array.isArray((order as { line_items?: unknown })?.line_items)
    ? ((order as { line_items: RawLineItem[] }).line_items)
    : []
  const deals = new Map<string, { units: number; products: Set<string> }>()
  for (const li of lineItems) {
    const raw = readProperty(li?.properties, '__kaching_bundles')
    if (!raw) continue
    let deal = ''
    try {
      const parsed = JSON.parse(raw) as { deal?: unknown }
      deal = typeof parsed?.deal === 'string' ? parsed.deal : ''
    } catch {
      deal = raw
    }
    if (!deal) continue
    const productId = li?.product_id != null ? String(li.product_id) : ''
    const qty = Number(li?.quantity) || 0
    const entry = deals.get(deal) ?? { units: 0, products: new Set<string>() }
    entry.units += qty
    if (productId) entry.products.add(productId)
    deals.set(deal, entry)
  }
  const out: Array<{ productId: string; units: number }> = []
  const seen = new Set<string>()
  for (const { units, products } of deals.values()) {
    if (units <= 0) continue
    for (const productId of products) {
      const key = `${productId}:${units}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ productId, units })
    }
  }
  return out
}

/** Localized fallback label when we only know the unit count. */
export function synthesizeLabel(units: number, locale: 'es' | 'en' = 'es'): string {
  if (locale === 'en') return units === 1 ? '1 unit' : `${units} units`
  return units === 1 ? '1 unidad' : `${units} unidades`
}

/**
 * Dedupe by `units`, fill in missing labels, drop invalid tiers, sort
 * ascending. When two detections share the same units, keep the first
 * non-empty label and the lowest defined price.
 */
export function normalizeDetectedOffers(
  detected: DetectedOffer[],
  locale: 'es' | 'en' = 'es',
): DetectedOffer[] {
  const byUnits = new Map<number, DetectedOffer>()
  for (const d of detected) {
    const units = Math.round(Number(d?.units))
    if (!Number.isFinite(units) || units <= 0 || units > 999) continue
    const prev = byUnits.get(units)
    if (!prev) {
      byUnits.set(units, { label: cleanLabel(d.label ?? ''), units, total: d.total })
      continue
    }
    if (!prev.label && d.label) prev.label = cleanLabel(d.label)
    if (d.total != null && (prev.total == null || d.total < prev.total)) prev.total = d.total
  }
  return [...byUnits.values()]
    .map((o) => ({
      ...o,
      label: o.label || synthesizeLabel(o.units, locale),
    }))
    .sort((a, b) => a.units - b.units)
}

interface ExistingOffer {
  label?: string
  total?: number | string
  units?: number
  conditions?: string
}

/**
 * Merge detected offers into whatever offers already exist, APPEND-ONLY:
 * add a detected tier only when its `units` isn't already present. Existing
 * entries are never modified. Returns the merged list + how many were added.
 */
export function mergeOffers(
  existing: ExistingOffer[],
  detected: DetectedOffer[],
): { offers: (ExistingOffer | DetectedOffer)[]; added: number } {
  const seen = new Set<number>()
  for (const o of existing) {
    const u = Math.round(Number(o?.units))
    if (Number.isFinite(u)) seen.add(u)
  }
  const additions = detected.filter((d) => !seen.has(d.units))
  return { offers: [...existing, ...additions], added: additions.length }
}
