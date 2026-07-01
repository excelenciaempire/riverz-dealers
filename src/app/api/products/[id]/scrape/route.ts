import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { csrfGuard } from '@/lib/csrf';
import { firecrawlScrape, FirecrawlError } from '@/lib/firecrawl/client';
import { serverError } from '@/lib/api/errors';
import { isPublicHttpsUrl } from '@/lib/security/url-guard';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { detectOffersFromScrapedContent } from '@/lib/shopify/offer-learning';

/**
 * POST /api/products/[id]/scrape
 *
 * Lanza Firecrawl sobre la URL pública del producto, guarda el
 * markdown, y marca scrape_status='done' o 'failed'. Síncrono — el
 * endpoint espera el resultado (Firecrawl suele responder en 5-15s
 * por URL). El cliente que lo llama desde /productos/[id] muestra
 * un spinner mientras tanto.
 *
 * Si el merchant quiere scrapear el catálogo entero, lo hace producto
 * por producto desde la lista (también podríamos agregar /scrape/all
 * más adelante con un cron, pero el control manual es más caro pero
 * más predecible al principio).
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

  const { data: product, error } = await supabase
    .from('shopify_products')
    .select('id, url, websites, allowed_offers, offers_auto_detected, bundle_metadata')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    return serverError(error);
  }
  if (!product) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Sources to read: the `websites` list (premium editor, up to 5), falling
  // back to the legacy single `url`. Dedup, keep only public https (SSRF
  // defense, same as the AI-agent routes).
  const rawSites = [
    ...(Array.isArray(product.websites) ? (product.websites as unknown[]) : []),
    product.url,
  ]
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean);
  const sites = [...new Set(rawSites)].filter((u) => isPublicHttpsUrl(u)).slice(0, 5);

  if (sites.length === 0) {
    return NextResponse.json(
      { error: translate(locale, 'errProducts.productNoPublicUrl') },
      { status: 400 },
    );
  }

  // Marcamos scraping antes de la llamada externa por si el endpoint
  // se demora — el front puede pollear este estado.
  await supabase
    .from('shopify_products')
    .update({
      scrape_status: 'scraping',
      scrape_error: null,
    })
    .eq('id', id);

  try {
    // Read every source; share the char budget across them so the combined
    // markdown stays bounded. A single failing URL doesn't sink the rest.
    const perUrl = Math.max(2_000, Math.floor(14_000 / sites.length));
    const chunks: string[] = [];
    const htmlChunks: string[] = [];
    const failures: string[] = [];
    for (const site of sites) {
      try {
        const scraped = await firecrawlScrape(site, { maxChars: perUrl });
        if (scraped.markdown.trim()) {
          chunks.push(
            sites.length > 1 ? `## ${site}\n\n${scraped.markdown}` : scraped.markdown,
          );
        }
        if (scraped.html) htmlChunks.push(scraped.html);
      } catch (e) {
        failures.push(`${site}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (chunks.length === 0) {
      throw new Error(failures.join(' · ') || 'Sin contenido');
    }
    const markdown = chunks.join('\n\n---\n\n');
    await supabase
      .from('shopify_products')
      .update({
        scrape_status: 'done',
        scraped_content: markdown,
        scraped_at: new Date().toISOString(),
        // Surface partial failures without failing the whole read.
        scrape_error: failures.length ? `Algunas URLs fallaron — ${failures.join(' · ')}` : null,
      })
      .eq('id', id);

    // Auto-detect offer tiers from the scraped page (bundle widgets render as
    // plain "2 Unidades + 1 GRATIS"/"3-pack" text regardless of the app that
    // drew them) → the editable "Precios" (allowed_offers). The AI reads
    // allowed_offers live, so a detected tier reaches the agent on the next
    // message. Idempotent — never clobbers offers the merchant edited by hand.
    const offersDetected = await detectOffersFromScrapedContent(
      supabase,
      product,
      { markdown, html: htmlChunks.join('\n') },
      locale === 'en' ? 'en' : 'es',
    );
    return NextResponse.json({
      ok: true,
      chars: markdown.length,
      sites: chunks.length,
      failed: failures.length,
      offers_detected: offersDetected,
    });
  } catch (err) {
    const msg =
      err instanceof FirecrawlError
        ? `${err.status}: ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    await supabase
      .from('shopify_products')
      .update({
        scrape_status: 'failed',
        scrape_error: msg,
      })
      .eq('id', id);
    // 502: el fallo es de Firecrawl (upstream), no interno. El detalle real
    // ya quedó persistido en scrape_error (visible al recargar); al cliente
    // le damos un mensaje genérico no-filtrante.
    return serverError(err, translate(locale, 'errProducts.scrapeFailed'), 502);
  }
}
