import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { csrfGuard } from '@/lib/csrf';
import { firecrawlScrape, FirecrawlError } from '@/lib/firecrawl/client';

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

  const { data: product, error } = await supabase
    .from('shopify_products')
    .select('id, url')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!product) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (!product.url) {
    return NextResponse.json(
      { error: 'El producto no tiene URL pública' },
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
    .eq('id', id)
    .eq('user_id', user.id);

  try {
    const scraped = await firecrawlScrape(product.url, {
      maxChars: 12_000,
    });
    await supabase
      .from('shopify_products')
      .update({
        scrape_status: 'done',
        scraped_content: scraped.markdown,
        scraped_at: new Date().toISOString(),
        scrape_error: null,
      })
      .eq('id', id)
      .eq('user_id', user.id);
    return NextResponse.json({ ok: true, chars: scraped.markdown.length });
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
      .eq('id', id)
      .eq('user_id', user.id);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
