-- ============================================================
-- 042: Shopify order fulfillment tracking
-- ============================================================
-- Shopify retired the orders/fulfilled topic. We now subscribe to
-- orders/updated and detect the "just fulfilled" transition by diffing
-- the previous fulfillment_status against the incoming one. This table
-- stores the last-seen fulfillment_status per (shop_domain, order_id)
-- so a single orders/updated delivery can be classified as
-- shopify_order_fulfilled when fulfillment_status flips from null/partial
-- to 'fulfilled'.

CREATE TABLE IF NOT EXISTS shopify_order_fulfillment_state (
  shop_domain TEXT NOT NULL,
  order_id BIGINT NOT NULL,
  fulfillment_status TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (shop_domain, order_id)
);

CREATE INDEX IF NOT EXISTS idx_shopify_order_fulfillment_state_updated_at
  ON shopify_order_fulfillment_state (updated_at);

ALTER TABLE shopify_order_fulfillment_state ENABLE ROW LEVEL SECURITY;
-- Service-role-only: webhooks write here via supabaseAdmin(). No user
-- queries this table directly.
DROP POLICY IF EXISTS "service role only" ON shopify_order_fulfillment_state;
CREATE POLICY "service role only" ON shopify_order_fulfillment_state
  FOR ALL USING (false);
