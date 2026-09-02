import type { SupabaseClient } from '@supabase/supabase-js';
import type { Locale } from '@/lib/i18n/config';
import { fuentesDe, leerFuentes } from './scrape-sources';

const SCRAPE_CONCURRENCY = 3;
const PRODUCT_COLUMNS = 'id, workspace_id, websites, prelanding_urls, url';

export interface CatalogScrapeResult {
  queued: number;
  scraped: number;
  failed: number;
}

/**
 * Refresh every public source in a Shopify catalog. Product sync only brings
 * the Admin API fields; this pass reads the storefront product URLs, manually
 * added sites, and discovered pre-landings so their current content is ready
 * for the agent immediately after a connection or catalog refresh.
 */
export async function scrapeShopifyCatalogSources(
  db: SupabaseClient,
  args: { workspaceId: string; shopDomain: string; locale?: Locale }
): Promise<CatalogScrapeResult> {
  const { data, error } = await db
    .from('shopify_products')
    .select(PRODUCT_COLUMNS)
    .eq('workspace_id', args.workspaceId)
    .eq('shop_domain', args.shopDomain);

  if (error) throw new Error(`catalog source lookup failed: ${error.message}`);

  const products = ((data ?? []) as Array<Record<string, unknown>>).filter(
    (product) => fuentesDe(product).length > 0
  );
  if (products.length === 0) return { queued: 0, scraped: 0, failed: 0 };

  // The status is persistent before the work starts, so the catalog makes the
  // refresh visible immediately and a later enrichment run can recover any
  // incomplete item if the host is interrupted.
  for (let index = 0; index < products.length; index += 200) {
    const ids = products
      .slice(index, index + 200)
      .map((product) => String(product.id));
    const { error: queueError } = await db
      .from('shopify_products')
      .update({ scrape_status: 'queued', scrape_error: null })
      .in('id', ids);
    if (queueError)
      throw new Error(`catalog source queue failed: ${queueError.message}`);
  }

  let next = 0;
  let scraped = 0;
  let failed = 0;
  const worker = async () => {
    while (next < products.length) {
      const product = products[next++];
      const result = await leerFuentes(db, product, args.locale ?? 'es');
      if (result.ok) scraped++;
      else failed++;
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(SCRAPE_CONCURRENCY, products.length) }, () =>
      worker()
    )
  );

  return { queued: products.length, scraped, failed };
}
