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
    readonly body?: unknown,
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
export async function firecrawlScrape(
  url: string,
  opts?: {
    /** Strip these CSS selectors before extraction (e.g. ".cookie-banner"). */
    excludeTags?: string[];
    /** Max markdown length to keep, in characters. Default 16 000. */
    maxChars?: number;
    /** AbortSignal for caller-side timeout. */
    signal?: AbortSignal;
  },
): Promise<FirecrawlScrapeResult> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new FirecrawlError('FIRECRAWL_API_KEY not configured', 500);
  }

  const body = {
    url,
    formats: ['markdown'],
    onlyMainContent: true,
    excludeTags: opts?.excludeTags ?? [
      'nav',
      'footer',
      '.cookie-banner',
      '.newsletter-signup',
    ],
    timeout: 30_000,
  };

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
    throw new FirecrawlError(`Firecrawl returned non-JSON: ${text.slice(0, 200)}`, res.status);
  }

  if (!res.ok || !json.success) {
    throw new FirecrawlError(
      json.error ?? `Firecrawl ${res.status}`,
      res.status,
      json,
    );
  }

  const markdown = (json.data?.markdown ?? '').slice(0, opts?.maxChars ?? 16_000);
  return {
    markdown,
    title: json.data?.metadata?.title ?? null,
    description: json.data?.metadata?.description ?? null,
    sourceUrl: json.data?.metadata?.sourceURL ?? url,
  };
}
