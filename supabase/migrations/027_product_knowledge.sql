-- ============================================================
-- 027: Product-level knowledge for the AI assistant
-- ============================================================
-- Extends shopify_products with everything the customer-service agent
-- needs to answer questions about a SPECIFIC product without forcing
-- the user to type the same info 50 times. The pipeline is:
--   1. Sync the catalog from Shopify (title, description, price)
--      → migration 025 columns.
--   2. Optionally scrape the public product URL with Firecrawl to grab
--      everything the merchant added on the storefront that doesn't
--      come back from the Admin REST product object (size charts,
--      ingredient lists, social proof, reviews).
--      → `scrape_*` columns below.
--   3. Run an Anthropic pass that generates a short research note +
--      likely FAQs from the combined Shopify + scraped material.
--      → `ai_*` columns.
--   4. Surface to the merchant for review/edit; they can override the
--      bot's notes or upload their own.
--      → `custom_*` columns.
--   5. The final `training_material` column is the concatenated text
--      the AI runtime injects into the system prompt when the agent
--      answers about THIS product. Rebuilt automatically whenever any
--      of the above sources change.
--
-- Bundle / add-on app detection (Kaching, ReConvert, Bold, etc.) lives
-- in `bundle_app` + `bundle_metadata`. We don't try to enumerate apps
-- here — the workspace's app installs are fetched once and stored as
-- a free-form string + jsonb so adding support for a new app is just a
-- new detector function, no migration.

ALTER TABLE shopify_products
  -- ── Firecrawl scraping ─────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS scrape_status TEXT
    NOT NULL DEFAULT 'idle'
    CHECK (scrape_status IN ('idle', 'queued', 'scraping', 'done', 'failed')),
  ADD COLUMN IF NOT EXISTS scraped_content TEXT,
  ADD COLUMN IF NOT EXISTS scraped_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scrape_error TEXT,

  -- ── User overrides ─────────────────────────────────────────────
  -- Anything the merchant wants the bot to know that isn't already on
  -- the product page. Markdown-friendly, no length cap on the column
  -- itself but the AI runner truncates at 4k characters per product.
  ADD COLUMN IF NOT EXISTS custom_notes TEXT,
  -- [{ "q": "¿Es vegano?", "a": "Sí, ..." }, ...]
  ADD COLUMN IF NOT EXISTS custom_faqs JSONB
    NOT NULL DEFAULT '[]'::jsonb,

  -- ── Anthropic-generated research / FAQs ────────────────────────
  ADD COLUMN IF NOT EXISTS ai_generated_faqs JSONB
    NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ai_research TEXT,
  ADD COLUMN IF NOT EXISTS ai_research_generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_research_status TEXT
    NOT NULL DEFAULT 'idle'
    CHECK (ai_research_status IN ('idle', 'queued', 'running', 'done', 'failed')),
  ADD COLUMN IF NOT EXISTS ai_research_error TEXT,

  -- ── Bundle / add-on app detection ──────────────────────────────
  ADD COLUMN IF NOT EXISTS is_bundle BOOLEAN NOT NULL DEFAULT false,
  -- e.g. "kaching_bundles" | "reconvert" | "bold_bundles" | "fbt" | "rebuy"
  -- — null when no add-on app applies, free-form so we can add new
  -- detectors without DDL.
  ADD COLUMN IF NOT EXISTS bundle_app TEXT,
  ADD COLUMN IF NOT EXISTS bundle_metadata JSONB,

  -- ── Compiled training blob ─────────────────────────────────────
  -- Concatenation of: title + description + custom_notes + ai_research
  -- + faqs (custom + ai) + scraped_content (tail-truncated). Rebuilt
  -- by the API whenever any source field changes. The AI runner reads
  -- ONLY this column — cheap, deterministic prompt assembly.
  ADD COLUMN IF NOT EXISTS training_material TEXT;

-- Index for the AI runner: when an inbound message references a
-- product by handle, we look it up by (workspace, handle).
CREATE INDEX IF NOT EXISTS idx_shopify_products_handle_user
  ON shopify_products(user_id, handle);

-- Index to drive the /productos status panel ("X synced, Y scraped,
-- Z still pending"). Partial: only the unfinished rows.
CREATE INDEX IF NOT EXISTS idx_shopify_products_scrape_pending
  ON shopify_products(user_id)
  WHERE scrape_status IN ('idle', 'queued');

COMMENT ON COLUMN shopify_products.training_material IS
  'Pre-rendered AI prompt fragment for this product. Built by /api/products/[id] PATCH; consumed by lib/ai/runner.ts.';
COMMENT ON COLUMN shopify_products.custom_faqs IS
  'Merchant-written FAQs. Shape: [{ "q": string, "a": string }]. Takes precedence over ai_generated_faqs when keys conflict.';
COMMENT ON COLUMN shopify_products.bundle_app IS
  'Detected upsell/bundle app slug. null when the product has no add-on offer. See lib/products/bundle-detection.ts.';
