import type { SupabaseClient } from '@supabase/supabase-js'

import { isPublicHttpsUrl } from '@/lib/security/url-guard'
import { buildTrainingMaterial } from '@/lib/products/training-material'
import { extractBalanced, normalizeDetectedOffers, offersFromKachingConfig, offersFromText, type DetectedOffer } from './detect-offers'

export interface LivePricing {
  offers: DetectedOffer[]
  priceMin: number
  priceMax: number
  currency: string | null
  source: 'kaching' | 'storefront'
}

export type LivePricingResult =
  | { ok: true; pricing: LivePricing }
  | { ok: false; reason: 'invalid_url' | 'fetch_failed' | 'price_missing' }

function money(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').replace(/,/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Recorre JSON-LD sin asumir cómo anidó Shopify `offers`. */
function collectOffers(value: unknown, into: Array<{ price: number; currency: string | null }>) {
  if (Array.isArray(value)) {
    for (const item of value) collectOffers(item, into)
    return
  }
  if (!value || typeof value !== 'object') return
  const row = value as Record<string, unknown>
  const type = Array.isArray(row['@type']) ? row['@type'].join(' ') : String(row['@type'] ?? '')
  if (/\bOffer\b/i.test(type)) {
    const price = money(row.price ?? row.lowPrice)
    if (price != null) {
      into.push({
        price,
        currency: typeof row.priceCurrency === 'string' ? row.priceCurrency.trim() || null : null,
      })
    }
  }
  for (const child of Object.values(row)) collectOffers(child, into)
}

/**
 * Extrae la fuente pública vigente sin ejecutar JavaScript.
 *
 * Kaching deja sus paquetes como JSON determinista en `dealBars`; Shopify deja
 * el precio normal como schema.org/Offer. La primera manda cuando existe,
 * porque es lo que realmente puede elegir la clienta en la página.
 */
export function pricingFromStorefrontHtml(html: string): LivePricing | null {
  const bundles = offersFromKachingConfig(html).filter(
    (o): o is DetectedOffer & { total: number } =>
      typeof o.total === 'number' && Number.isFinite(o.total) && o.total > 0,
  )
  if (bundles.length > 0) {
    const totals = bundles.map((o) => o.total)
    return {
      offers: bundles,
      priceMin: Math.min(...totals),
      priceMax: Math.max(...totals),
      currency: storefrontCurrency(html),
      source: 'kaching',
    }
  }

  // Custom Shopify themes may render bundle cards client-side, while keeping
  // the same current tiers in the public product description. That metadata
  // is part of the storefront response and is therefore a live source too.
  const metadataOffers = offersFromProductMetadata(html).filter(
    (o): o is DetectedOffer & { total: number } =>
      typeof o.total === 'number' && Number.isFinite(o.total) && o.total > 0,
  )
  if (metadataOffers.length > 1) {
    const totals = metadataOffers.map((o) => o.total)
    return {
      offers: metadataOffers,
      priceMin: Math.min(...totals),
      priceMax: Math.max(...totals),
      currency: storefrontCurrency(html),
      source: 'storefront',
    }
  }

  const found: Array<{ price: number; currency: string | null }> = []
  const scripts = html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )
  for (const match of scripts) {
    try {
      collectOffers(JSON.parse(match[1]), found)
    } catch {
      /* un bloque inválido no invalida los demás */
    }
  }
  // Custom Shopify product templates may omit JSON-LD. Shopify still embeds
  // the current product's variant prices in its Web Pixels initialization.
  // These are monetary amounts, not the cents used by analytics meta.price.
  if (found.length === 0) found.push(...pricesFromShopifyPixels(html))
  if (found.length === 0) return null
  const prices = found.map((o) => o.price)
  return {
    offers: [],
    priceMin: Math.min(...prices),
    priceMax: Math.max(...prices),
    currency: found.find((o) => o.currency)?.currency ?? storefrontCurrency(html),
    source: 'storefront',
  }
}

function pricesFromShopifyPixels(html: string): Array<{ price: number; currency: string }> {
  for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const source = script[1]
    if (!/\bwpmLoader\s*\(/.test(source)) continue
    const start = /\binitData\s*:\s*\{/.exec(source)
    if (!start) continue
    const raw = extractBalanced(source, source.indexOf('{', start.index), '{', '}')
    if (!raw) continue
    try {
      const data = JSON.parse(raw)
      if (!Array.isArray(data.productVariants) || data.productVariants.length === 0) continue
      const productIds = new Set<string>()
      const currencies = new Set<string>()
      const prices: Array<{ price: number; currency: string }> = []
      for (const variant of data.productVariants) {
        const price = money(variant?.price?.amount)
        const currency = variant?.price?.currencyCode
        const productId = variant?.product?.id
        if (price == null || typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency) || !productId) continue
        productIds.add(String(productId))
        currencies.add(currency)
        prices.push({ price, currency })
      }
      // Never combine recommendations, currencies or incomplete variant data
      // into an apparently verified price for the current product.
      if (productIds.size === 1 && currencies.size === 1 && prices.length === data.productVariants.length) return prices
    } catch {
      /* A malformed initialization is not a verified price. Never execute it. */
    }
  }
  return []
}

function storefrontCurrency(html: string): string | null {
  const m = html.match(/Shopify\.currency\s*=\s*\{[^}]*["']active["']\s*:\s*["']([A-Z]{3})["']/i)
  return m?.[1]?.toUpperCase() ?? null
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
}

/** Visible offer copy that Shopify publishes in the product metadata. */
function offersFromProductMetadata(html: string): DetectedOffer[] {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? []
  for (const tag of tags) {
    if (!/\bname\s*=\s*["']description["']/i.test(tag)) continue
    const content = tag.match(/\bcontent\s*=\s*(["'])([\s\S]*?)\1/i)?.[2]
    if (!content) continue
    const decoded = decodeHtmlAttribute(content)
    const offers = normalizeDetectedOffers(offersFromText(decoded), 'es').map((offer) => {
      const secondFree =
        offer.units === 2 &&
        /(?:segund[oa]\s+par\s+(?:es\s+)?gratis|paga\s+1\s+par\s+y\s+ll[eé]vate\s+(?:el\s+)?segundo)/i.test(decoded)
      return secondFree
        ? { ...offer, label: 'Paga 1 par y llévate 2 (segundo par gratis)' }
        : offer
    })
    if (offers.length > 0) return offers
  }
  return []
}

export async function readLivePricing(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<LivePricingResult> {
  if (!isPublicHttpsUrl(url)) return { ok: false, reason: 'invalid_url' }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8_000)
  try {
    const response = await fetcher(url, {
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal,
      headers: { Accept: 'text/html,application/xhtml+xml' },
    })
    if (!response.ok) return { ok: false, reason: 'fetch_failed' }
    const pricing = pricingFromStorefrontHtml(await response.text())
    return pricing ? { ok: true, pricing } : { ok: false, reason: 'price_missing' }
  } catch {
    return { ok: false, reason: 'fetch_failed' }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Verifica y persiste el precio público justo antes de que un agente lo cite.
 * El storefront es autoritativo incluso si la oferta se editó antes a mano en
 * Riverz: una clienta sólo puede comprar lo que la página ofrece ahora.
 */
export async function refreshLivePricing(
  db: SupabaseClient,
  productId: string,
): Promise<LivePricingResult> {
  const { data: product } = await db
    .from('shopify_products')
    .select('id, url, currency, bundle_metadata, allowed_offers, offers_auto_detected')
    .eq('id', productId)
    .maybeSingle()
  const url = typeof product?.url === 'string' ? product.url : ''
  if (!product || !url) return { ok: false, reason: 'invalid_url' }

  const result = await readLivePricing(url)
  if (!result.ok) return result
  const { pricing } = result
  const previousMeta =
    product.bundle_metadata && typeof product.bundle_metadata === 'object'
      ? (product.bundle_metadata as Record<string, unknown>)
      : {}
  const update: Record<string, unknown> = {
    price_min: pricing.priceMin,
    price_max: pricing.priceMax,
    currency: pricing.currency || product.currency || null,
    bundle_metadata: {
      ...previousMeta,
      pricing_verified_at: new Date().toISOString(),
      pricing_verified_source: pricing.source,
    },
  }
  if (pricing.offers.length > 0) {
    const existing = Array.isArray(product.allowed_offers)
      ? (product.allowed_offers as Array<Record<string, unknown>>)
      : []
    // Preserve merchant-authored conditions while updating the label, units
    // and total from the live storefront.
    update.allowed_offers = pricing.offers.map((offer) => {
      const previous = existing.find((row) => Number(row.units) === offer.units)
      return previous ? { ...previous, ...offer } : offer
    })
    update.offers_auto_detected = product.offers_auto_detected === false ? false : true
  }
  const { error } = await db.from('shopify_products').update(update).eq('id', productId)
  if (error) return { ok: false, reason: 'fetch_failed' }

  // `training_material` es una compilación persistida. Actualizar las columnas
  // sin recompilarlo dejaba la cabecera “Precio: 39.990–99.900” aunque
  // allowed_offers ya dijera 109.990.
  const { data: refreshed } = await db.from('shopify_products').select('*').eq('id', productId).maybeSingle()
  if (refreshed) {
    const oldMaterial = typeof refreshed.training_material === 'string' ? refreshed.training_material : ''
    const locale = /(?:^|\n)## (?:Description|Price)\b/i.test(oldMaterial) ? 'en' : 'es'
    await db
      .from('shopify_products')
      .update({ training_material: buildTrainingMaterial(refreshed, locale) })
      .eq('id', productId)
  }
  return result
}
