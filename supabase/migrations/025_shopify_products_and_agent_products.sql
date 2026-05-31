-- ============================================================
-- 025: Shopify product catalog + agent ↔ product binding
-- ============================================================
-- shopify_products mirrors a synced snapshot of the store catalog.
-- We don't try to be a source of truth — orders / inventory still live
-- in Shopify — we just keep enough to feed the AI assistant a useful
-- product knowledge base (title, description, price range, tags, URL).
--
-- The sync happens at OAuth callback + on demand via
-- /api/shopify/products/sync. Rows are upserted by
-- (shop_domain, external_id) so re-syncs are idempotent.

CREATE TABLE IF NOT EXISTS shopify_products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shop_domain TEXT NOT NULL,
  external_id BIGINT NOT NULL,

  handle TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  product_type TEXT,
  vendor TEXT,
  tags TEXT[] DEFAULT '{}'::TEXT[],

  price_min NUMERIC,
  price_max NUMERIC,
  currency TEXT,
  image_url TEXT,
  url TEXT,

  raw JSONB,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (shop_domain, external_id)
);

CREATE INDEX IF NOT EXISTS idx_shopify_products_user
  ON shopify_products(user_id);
CREATE INDEX IF NOT EXISTS idx_shopify_products_shop
  ON shopify_products(shop_domain);

ALTER TABLE shopify_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owner reads own products" ON shopify_products;
CREATE POLICY "Owner reads own products" ON shopify_products
  FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Owner writes own products" ON shopify_products;
CREATE POLICY "Owner writes own products" ON shopify_products
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Agent → product binding. Honored only when ai_agents.product_scope = 'specific'.
ALTER TABLE ai_agents
  ADD COLUMN IF NOT EXISTS product_scope TEXT NOT NULL DEFAULT 'all'
    CHECK (product_scope IN ('all', 'specific'));

CREATE TABLE IF NOT EXISTS ai_agent_products (
  agent_id UUID NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES shopify_products(id) ON DELETE CASCADE,
  PRIMARY KEY (agent_id, product_id)
);

ALTER TABLE ai_agent_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members manage ai_agent_products" ON ai_agent_products;
CREATE POLICY "Members manage ai_agent_products" ON ai_agent_products FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM ai_agents a
      WHERE a.id = ai_agent_products.agent_id
        AND is_workspace_member(a.workspace_id)
    )
  );
