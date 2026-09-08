import { cancelar, liquidar, reservar } from '@/lib/wallet/operacion';
import type { SupabaseClient } from '@supabase/supabase-js';
/**
 * Firecrawl client — scrape product URLs to enrich the AI knowledge.
 *
 * Why we use Firecrawl instead of fetching raw HTML:
 *   - Stripped clean markdown (no ads, no sidebars).
 *   - Handles JS-rendered storefronts (Shopify Hydrogen, headless setups).
 *   - Built-in respect for robots.txt and rate limiting.
 *
 * Auth: FIRECRAWL_API_KEY in the service env. The key is stored as
 * "fc-..." per Firecrawl's convention.
 *
 * Cost note: the v1 /scrape endpoint costs ~1 credit per URL. A merchant
 * with 200 products costs ~200 credits to fully scrape — well within
 * the free tier (500 credits/mo). We don't auto-retry on failure; the
 * /productos page exposes a per-product "Re-scrape" button.
 */

const ENDPOINT = 'https://api.firecrawl.dev/v1/scrape';

export interface FirecrawlScrapeResult {
  /** Markdown body extracted from the page. Capped at 16 KB by us. */
  markdown: string;
  /** Raw HTML of the page (for structured parsing, e.g. embedded bundle
   *  config that renders client-side). Capped; null if unavailable. */
  html: string | null;
  /** Page title (typically <title>). */
  title: string | null;
  /** Cleaned meta description. */
  description: string | null;
  /** URL we actually scraped (after any redirects). */
  sourceUrl: string;
}

export class FirecrawlError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown
  ) {
    super(message);
    this.name = 'FirecrawlError';
  }
}

/**
 * Scrape a URL and return the markdown body + metadata. Throws
 * FirecrawlError on non-2xx so the caller can persist the error on
 * shopify_products.scrape_error and surface it in the UI.
 */
/**
 * Lo que sale leer UNA página, en USD.
 *
 * Firecrawl cobra un crédito por URL; en el plan que usamos eso es ~0,001 USD.
 * Es un proveedor conectado más, así que el costo se le pasa al comercio.
 */
export const USD_POR_PAGINA = Number(
  process.env.FIRECRAWL_USAGE_USD_PER_CREDIT ?? 0
);
// Zero means the credits come from a monthly subscription and are not passed on.

export async function firecrawlScrape(
  url: string,
  opts?: {
    /** Strip these CSS selectors before extraction (e.g. ".cookie-banner"). */
    excludeTags?: string[];
    /** Max markdown length to keep, in characters. Default 16 000. */
    maxChars?: number;
    /** AbortSignal for caller-side timeout. */
    signal?: AbortSignal;
    /**
     * A quién cobrarle la página.
     *
     * Va acá y no en cada llamador porque leer una web cuesta plata en los
     * cuatro sitios que la leen, y dejarlo del lado del llamador es cómo se
     * olvida. `db` y `workspaceId` juntos o ninguno; sin ellos no se cobra y
     * queda un aviso, que es mejor que un cobro silencioso a nadie.
     */
    cobrarA?: { db: SupabaseClient; workspaceId: string };
  }
): Promise<FirecrawlScrapeResult> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new FirecrawlError('FIRECRAWL_API_KEY not configured', 500);
  }

  const body = {
    url,
    // rawHtml carries bundle-app config (Kaching dealBars etc.) that renders
    // client-side and may be missing/late in the extracted markdown.
    formats: ['markdown', 'rawHtml'],
    onlyMainContent: true,
    excludeTags: opts?.excludeTags ?? [
      'nav',
      'footer',
      '.cookie-banner',
      '.newsletter-signup',
    ],
    timeout: 30_000,
  };

  if (!opts?.cobrarA) throw new Error('wallet_billing_context_required');
  if (!Number.isFinite(USD_POR_PAGINA) || USD_POR_PAGINA < 0)
    throw new Error('wallet_firecrawl_rate_not_configured');
  const billing = { ...opts.cobrarA, concepto: 'lectura_de_pagina' };
  const operation =
    USD_POR_PAGINA > 0
      ? await reservar(billing, 'firecrawl', USD_POR_PAGINA, {
          url: url.slice(0, 300),
        })
      : null;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: opts?.signal,
  });

  const text = await res.text();
  let json: {
    success?: boolean;
    data?: {
      markdown?: string;
      rawHtml?: string;
      metadata?: {
        title?: string;
        description?: string;
        sourceURL?: string;
      };
    };
    error?: string;
  };
  try {
    json = JSON.parse(text);
  } catch {
    throw new FirecrawlError(
      `Firecrawl returned non-JSON: ${text.slice(0, 200)}`,
      res.status
    );
  }

  if (!res.ok || !json.success) {
    if (operation && [400, 401, 402, 403, 404, 429].includes(res.status))
      await cancelar(billing, operation);
    throw new FirecrawlError(
      json.error ?? `Firecrawl ${res.status}`,
      res.status,
      json
    );
  }

  if (operation)
    await liquidar(billing, operation, 'firecrawl', USD_POR_PAGINA, {
      url: url.slice(0, 300),
    });
  const markdown = (json.data?.markdown ?? '').slice(
    0,
    opts?.maxChars ?? 16_000
  );
  // Firecrawl puede devolver 200 + success:true con markdown vacío
  // cuando la URL está bloqueada por Cloudflare, requiere JS sin SSR,
  // o está gated. Lo tratamos como fallo explícito para que la UI no
  // marque al producto como "Entrenado" cuando en realidad no hay
  // contenido para el AI.
  if (!markdown.trim()) {
    throw new FirecrawlError(
      'Firecrawl devolvió contenido vacío (página probablemente bloqueada por Cloudflare o sin contenido visible)',
      204,
      json
    );
  }
  // Keep the raw HTML bounded — we only scan it for embedded offer config.
  const html = json.data?.rawHtml
    ? json.data.rawHtml.slice(0, 1_500_000)
    : null;
  // La página se leyó: se cobra. Sólo cuando salió bien — un error no le dio
  // nada a nadie.
  return {
    markdown,
    html,
    title: json.data?.metadata?.title ?? null,
    description: json.data?.metadata?.description ?? null,
    sourceUrl: json.data?.metadata?.sourceURL ?? url,
  };
}

/**
 * De qué comercio es el producto que se está leyendo.
 *
 * Los tres caminos que leen fuentes tienen el producto en la mano y el
 * `workspace_id` viene en la fila. Se resuelve acá para que los tres lo hagan
 * igual y para que el que agregue un cuarto lo encuentre.
 */
export function workspaceDelProducto(
  db: SupabaseClient,
  product: Record<string, unknown>
): { db: SupabaseClient; workspaceId: string } | undefined {
  const ws =
    typeof product.workspace_id === 'string' ? product.workspace_id : '';
  return ws ? { db, workspaceId: ws } : undefined;
}
