import type { SupabaseClient } from '@supabase/supabase-js'
import type { Locale } from '@/lib/i18n/config'
import { firecrawlScrape } from '@/lib/firecrawl/client'
import { isPublicHttpsUrl } from '@/lib/security/url-guard'
import { detectOffersFromScrapedContent } from '@/lib/shopify/offer-learning'
import {
  buildResearchPrompt,
  parseResearchResponse,
  RESEARCH_MODEL,
  RESEARCH_MAX_TOKENS,
} from './research'

/**
 * Full per-product enrichment: scrape the page if we haven't, detect its
 * offers, then generate research (FAQs / description / objections / guardrails)
 * and persist — everything the merchant used to click "Generar investigación"
 * for. Shared by (a) the manual ai-research route and (b) connect-time
 * auto-enrichment, so both behave identically.
 *
 * The model call is the only Anthropic-dependent step; the scrape + offer
 * detection run regardless (free), so even with no Anthropic balance a connect
 * still auto-fills offers from the page — research just lands as 'failed' and
 * re-runs successfully once credits exist.
 */

const RESEARCH_COLUMNS =
  'id, title, description, scraped_content, product_type, vendor, tags, custom_notes, custom_faqs, structured_research, price_min, price_max, bundle_app, bundle_metadata, allowed_offers, offers_auto_detected, say_guidelines, never_say, escalation_triggers, websites, url'

export interface EnrichResult {
  ok: boolean
  faqsCount?: number
  error?: string
  /** 'not_found' | 'no_api_key' | 'model' — lets callers map to HTTP codes. */
  reason?: 'not_found' | 'no_api_key' | 'model'
}

/** Scrape the product's URLs if we have none yet; detect offers from the read. */
async function ensureScrapedContent(
  db: SupabaseClient,
  product: Record<string, unknown>,
  locale: Locale,
): Promise<string | null> {
  let scraped = (product.scraped_content as string | null) ?? null
  if (scraped?.trim()) return scraped

  const sites = [
    ...(Array.isArray(product.websites) ? (product.websites as unknown[]) : []),
    product.url,
  ]
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean)
  const valid = [...new Set(sites)].filter((u) => isPublicHttpsUrl(u)).slice(0, 5)
  if (valid.length === 0) return null

  const perUrl = Math.max(2_000, Math.floor(14_000 / valid.length))
  const chunks: string[] = []
  for (const site of valid) {
    try {
      const s = await firecrawlScrape(site, { maxChars: perUrl })
      if (s.markdown.trim()) {
        chunks.push(valid.length > 1 ? `## ${site}\n\n${s.markdown}` : s.markdown)
      }
    } catch {
      /* one failing URL doesn't sink the rest */
    }
  }
  if (chunks.length === 0) return null

  scraped = chunks.join('\n\n---\n\n')
  await db
    .from('shopify_products')
    .update({
      scraped_content: scraped,
      scrape_status: 'done',
      scraped_at: new Date().toISOString(),
    })
    .eq('id', product.id as string)
  // The page we just read also carries the offer tiers.
  await detectOffersFromScrapedContent(
    db,
    product as { id: string },
    scraped,
    locale === 'en' ? 'en' : 'es',
  )
  return scraped
}

export async function enrichProduct(
  db: SupabaseClient,
  productId: string,
  locale: Locale,
): Promise<EnrichResult> {
  const { data: product, error } = await db
    .from('shopify_products')
    .select(RESEARCH_COLUMNS)
    .eq('id', productId)
    .maybeSingle()
  if (error || !product) return { ok: false, reason: 'not_found', error: 'not found' }

  await db
    .from('shopify_products')
    .update({ ai_research_status: 'running', ai_research_error: null })
    .eq('id', productId)

  const scrapedContent = await ensureScrapedContent(db, product, locale)

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    await db
      .from('shopify_products')
      .update({ ai_research_status: 'failed', ai_research_error: 'ANTHROPIC_API_KEY missing' })
      .eq('id', productId)
    return { ok: false, reason: 'no_api_key', error: 'ANTHROPIC_API_KEY missing' }
  }

  const prompt = buildResearchPrompt(product, scrapedContent, locale)
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: RESEARCH_MODEL,
        max_tokens: RESEARCH_MAX_TOKENS,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json?.error?.message ?? `Anthropic ${res.status}`)
    const text = json?.content?.[0]?.text ?? ''
    const { update, faqsCount } = parseResearchResponse(text, product, scrapedContent, locale)
    await db.from('shopify_products').update(update).eq('id', productId)
    return { ok: true, faqsCount }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await db
      .from('shopify_products')
      .update({ ai_research_status: 'failed', ai_research_error: msg })
      .eq('id', productId)
    return { ok: false, reason: 'model', error: msg }
  }
}

/**
 * Enrich a workspace/store's products in a bounded, error-tolerant batch. By
 * default only touches products that don't already have research (idle/failed),
 * newest-synced first, capped so a big catalog can't blow Firecrawl/Anthropic
 * quota in one pass. Never throws — returns counts.
 */
export async function enrichProducts(
  db: SupabaseClient,
  args: {
    workspaceId?: string
    shopDomain?: string
    max?: number
    locale?: Locale
    includeDone?: boolean
  },
): Promise<{ attempted: number; enriched: number; failed: number }> {
  const max = Math.max(1, Math.min(args.max ?? 25, 200))
  let q = db.from('shopify_products').select('id, ai_research_status, synced_at')
  if (args.shopDomain) q = q.eq('shop_domain', args.shopDomain)
  if (args.workspaceId) q = q.eq('workspace_id', args.workspaceId)
  const { data: prods } = await q.order('synced_at', { ascending: false })

  let list = (prods ?? []) as Array<{ id: string; ai_research_status?: string | null }>
  if (!args.includeDone) {
    list = list.filter(
      (p) => p.ai_research_status !== 'done' && p.ai_research_status !== 'running',
    )
  }
  list = list.slice(0, max)

  let enriched = 0
  let failed = 0
  for (const p of list) {
    const r = await enrichProduct(db, p.id, args.locale ?? 'es')
    if (r.ok) enriched++
    else failed++
    // Gentle spacing — respect Firecrawl + Anthropic rate limits.
    await new Promise((res) => setTimeout(res, 300))
  }
  return { attempted: list.length, enriched, failed }
}
