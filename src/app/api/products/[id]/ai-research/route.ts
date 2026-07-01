import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { csrfGuard } from '@/lib/csrf';
import { serverError } from '@/lib/api/errors';
import { firecrawlScrape } from '@/lib/firecrawl/client';
import { detectOffersFromScrapedContent } from '@/lib/shopify/offer-learning';
import { isPublicHttpsUrl } from '@/lib/security/url-guard';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import {
  buildResearchPrompt,
  parseResearchResponse,
  RESEARCH_MODEL,
  RESEARCH_MAX_TOKENS,
} from '@/lib/products/research';

/**
 * POST /api/products/[id]/ai-research
 *
 * Genera FAQs + una breve nota de investigación sobre el producto
 * usando Anthropic. Input: título, descripción, scraped_content si
 * existe. Output: ai_generated_faqs (array {q, a}) + ai_research
 * (texto breve sobre uso típico, audiencia, comparativas).
 *
 * Idempotente — corre múltiples veces; sobreescribe los campos ai_*.
 */
export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const block = await csrfGuard(req);
  if (block) return block;
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const locale = await getLocale();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: translate(locale, 'errProducts.anthropicKeyMissing') },
      { status: 500 },
    );
  }

  const { data: product, error } = await supabase
    .from('shopify_products')
    .select(
      'id, title, description, scraped_content, product_type, vendor, tags, custom_notes, custom_faqs, structured_research, price_min, price_max, bundle_app, bundle_metadata, allowed_offers, offers_auto_detected, say_guidelines, never_say, escalation_triggers, websites, url',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) {
    return serverError(error);
  }
  if (!product) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  await supabase
    .from('shopify_products')
    .update({ ai_research_status: 'running', ai_research_error: null })
    .eq('id', id);

  // Si hay URLs y todavía no leímos su contenido, las scrapeamos ahora para
  // que alimenten la investigación — así "las URLs llenan todo" sin que el
  // merchant tenga que pulsar "Re-leer" antes. Best-effort: si Firecrawl
  // falla, seguimos con lo que haya. Si ya hay scraped_content, lo reusamos.
  let scrapedContent = (product.scraped_content as string | null) ?? null;
  if (!scrapedContent?.trim()) {
    const sites = [
      ...(Array.isArray(product.websites) ? (product.websites as unknown[]) : []),
      product.url,
    ]
      .map((s) => (typeof s === 'string' ? s.trim() : ''))
      .filter(Boolean);
    const valid = [...new Set(sites)].filter((u) => isPublicHttpsUrl(u)).slice(0, 5);
    if (valid.length) {
      const perUrl = Math.max(2_000, Math.floor(14_000 / valid.length));
      const chunks: string[] = [];
      for (const site of valid) {
        try {
          const s = await firecrawlScrape(site, { maxChars: perUrl });
          if (s.markdown.trim()) {
            chunks.push(valid.length > 1 ? `## ${site}\n\n${s.markdown}` : s.markdown);
          }
        } catch {
          /* una URL que falla no hunde el resto */
        }
      }
      if (chunks.length) {
        scrapedContent = chunks.join('\n\n---\n\n');
        await supabase
          .from('shopify_products')
          .update({
            scraped_content: scrapedContent,
            scrape_status: 'done',
            scraped_at: new Date().toISOString(),
          })
          .eq('id', id);
        // Same page we just read also carries the offer tiers — detect them
        // into allowed_offers so "the URLs fill everything" includes offers.
        await detectOffersFromScrapedContent(
          supabase,
          product,
          scrapedContent,
          locale === 'en' ? 'en' : 'es',
        );
      }
    }
  }

  // Prompt + response parsing live in src/lib/products/research.ts so the
  // same pipeline is unit-testable and reusable by connect-time enrichment.
  const userPrompt = buildResearchPrompt(product, scrapedContent, locale);

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
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json?.error?.message ?? `Anthropic ${res.status}`);
    }
    const text = json?.content?.[0]?.text ?? '';
    const { update, faqsCount } = parseResearchResponse(
      text,
      product,
      scrapedContent,
      locale,
    );

    await supabase.from('shopify_products').update(update).eq('id', id);

    return NextResponse.json({ ok: true, faqs_count: faqsCount });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase
      .from('shopify_products')
      .update({
        ai_research_status: 'failed',
        ai_research_error: msg,
      })
      .eq('id', id);
    // 502: fallo del proveedor de IA (upstream). El detalle ya quedó en
    // ai_research_error; al cliente, mensaje genérico no-filtrante.
    return serverError(err, translate(locale, 'errProducts.researchFailed'), 502);
  }
}
