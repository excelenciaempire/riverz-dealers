-- ============================================================
-- 093: Detected store currency on shopify_connections
-- ============================================================
-- Shopify's /shop.json exposes the store's default currency (ISO 4217).
-- We already read it at checkout-link time, but never persisted it, so
-- the products catalog synced currency=null and every agent/checkout path
-- fell back to a hardcoded 'ARS'. Capture it once at connect/sync time so
-- it becomes the workspace's canonical currency: products get stamped with
-- it, manual products default to it, and the AI runner tells every agent
-- which currency to quote in.
--
-- Resolution priority stays: an explicit workspace_checkout_config.currency
-- (e.g. Pilar = 'ARS') always wins; this column is the auto-detected
-- fallback below it. See src/lib/products/currency.ts.

ALTER TABLE shopify_connections
  ADD COLUMN IF NOT EXISTS currency TEXT;

COMMENT ON COLUMN shopify_connections.currency IS
  'ISO 4217 code auto-detected from the store /shop.json at connect/sync time.';
