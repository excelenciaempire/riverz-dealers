/**
 * Bundle / add-on app detection.
 *
 * Shopify merchants commonly install third-party apps that decorate
 * products with bundle offers, post-purchase upsells, or "frequently
 * bought together" widgets. We try to detect the most common ones
 * from the raw Shopify product payload so the AI can answer questions
 * like "tienes algún combo con este producto?" without the merchant
 * having to type each offer manually.
 *
 * Detection signals (no app installs API required):
 *   - Tags: many bundle apps tag products ("bundle", "kaching-bundle", "fbt-source").
 *   - Product type: "Bundle", "Combo", "Pack" are conventional.
 *   - Metafields: most apps write to a namespace like "kaching_bundles",
 *     "reconvert", "bold_bundles" on the product.
 *   - Title heuristics: "Pack 2", "Combo Familia", "Bundle de ...".
 *
 * Returns a slug + minimal metadata. The caller persists this on
 * shopify_products.bundle_app + bundle_metadata. The AI runtime reads
 * `is_bundle` to know it should expect questions about offers.
 */

export type BundleAppSlug =
  | 'kaching_bundles'
  | 'reconvert'
  | 'bold_bundles'
  | 'frequently_bought_together'
  | 'rebuy'
  | 'generic_bundle'
  | null;

export interface BundleDetection {
  isBundle: boolean;
  app: BundleAppSlug;
  /** Raw signal we matched on. Lets the UI explain "Detectado por: tag 'kaching-bundle'". */
  signals: string[];
  /** Anything app-specific worth keeping (offer slugs, discount %s). */
  metadata: Record<string, unknown> | null;
}

interface RawShopifyProduct {
  title?: string;
  product_type?: string;
  tags?: string | string[];
  metafields?: Array<{ namespace?: string; key?: string; value?: string }>;
  /** Some apps set this on the product object directly. */
  bundle?: unknown;
}

/**
 * Inspect the raw Shopify product payload + tags array and return a
 * detection result. Pure function — easy to unit-test.
 */
export function detectBundleApp(
  raw: RawShopifyProduct | undefined | null,
  tags: string[] = [],
): BundleDetection {
  if (!raw) {
    return { isBundle: false, app: null, signals: [], metadata: null };
  }

  const signals: string[] = [];
  const tagSet = new Set(
    [
      ...(typeof raw.tags === 'string'
        ? raw.tags.split(',').map((t) => t.trim().toLowerCase())
        : (raw.tags ?? []).map((t) => t.toLowerCase())),
      ...tags.map((t) => t.toLowerCase()),
    ].filter(Boolean),
  );
  const title = (raw.title ?? '').toLowerCase();
  const productType = (raw.product_type ?? '').toLowerCase();
  const metafields = raw.metafields ?? [];
  const namespaces = new Set(
    metafields
      .map((m) => (m.namespace ?? '').toLowerCase())
      .filter(Boolean),
  );

  let app: BundleAppSlug = null;
  let metadata: Record<string, unknown> | null = null;

  // ── Kaching Bundles ─────────────────────────────────────────────
  // App namespace: "kaching_bundles" or "kachingbundles".
  // Tags they commonly set: "kaching-bundle", "kb-bundle".
  if (
    namespaces.has('kaching_bundles') ||
    namespaces.has('kachingbundles') ||
    tagSet.has('kaching-bundle') ||
    tagSet.has('kb-bundle')
  ) {
    app = 'kaching_bundles';
    signals.push('kaching_bundles metafield namespace or tag');
    metadata = collectMetafields(metafields, ['kaching_bundles', 'kachingbundles']);
  }
  // ── ReConvert ───────────────────────────────────────────────────
  else if (
    namespaces.has('reconvert') ||
    tagSet.has('reconvert-upsell')
  ) {
    app = 'reconvert';
    signals.push('reconvert metafield namespace or tag');
    metadata = collectMetafields(metafields, ['reconvert']);
  }
  // ── Bold Bundles ────────────────────────────────────────────────
  else if (
    namespaces.has('bold_bundles') ||
    namespaces.has('bold') ||
    tagSet.has('bold-bundle')
  ) {
    app = 'bold_bundles';
    signals.push('bold_bundles metafield namespace or tag');
    metadata = collectMetafields(metafields, ['bold_bundles', 'bold']);
  }
  // ── Frequently Bought Together (Shopify's own + Glood + Boost) ──
  else if (
    namespaces.has('fbt') ||
    tagSet.has('fbt-source') ||
    tagSet.has('frequently-bought-together')
  ) {
    app = 'frequently_bought_together';
    signals.push('fbt namespace or tag');
    metadata = collectMetafields(metafields, ['fbt']);
  }
  // ── Rebuy ───────────────────────────────────────────────────────
  else if (namespaces.has('rebuy')) {
    app = 'rebuy';
    signals.push('rebuy metafield namespace');
    metadata = collectMetafields(metafields, ['rebuy']);
  }
  // ── Generic bundle heuristic ────────────────────────────────────
  else if (
    productType.includes('bundle') ||
    productType.includes('combo') ||
    productType.includes('pack') ||
    /\b(combo|bundle|pack|kit|duo|trio)\b/.test(title) ||
    tagSet.has('bundle') ||
    tagSet.has('combo') ||
    tagSet.has('pack')
  ) {
    app = 'generic_bundle';
    if (productType.includes('bundle') || productType.includes('combo') || productType.includes('pack'))
      signals.push(`product_type "${raw.product_type}"`);
    if (/\b(combo|bundle|pack|kit|duo|trio)\b/.test(title))
      signals.push(`title contains bundle keyword`);
    if (tagSet.has('bundle') || tagSet.has('combo') || tagSet.has('pack'))
      signals.push('bundle tag');
  }

  return {
    isBundle: app !== null,
    app,
    signals,
    metadata,
  };
}

function collectMetafields(
  metafields: Array<{ namespace?: string; key?: string; value?: string }>,
  namespaces: string[],
): Record<string, unknown> {
  const out: Record<string, string> = {};
  for (const m of metafields) {
    const ns = (m.namespace ?? '').toLowerCase();
    if (!namespaces.includes(ns)) continue;
    if (m.key && m.value) {
      out[`${ns}.${m.key}`] = m.value.slice(0, 1000);
    }
  }
  return out;
}
