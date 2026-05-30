-- ============================================================
-- 021: Shopify connections (OAuth + webhooks)
-- ============================================================
-- Stores one connected Shopify store per (user, shop). The Admin API
-- access token is encrypted with the same AES-256-GCM helper used for
-- WhatsApp tokens (src/lib/whatsapp/encryption.ts) — a single iv:ct:tag
-- string, not Riverz's separate iv/tag columns.
--
-- Abandoned-checkout webhooks (checkouts/create, checkouts/update) match
-- the shop via x-shopify-shop-domain → this row → user_id, then fire
-- automations with trigger_type='shopify_abandoned_checkout'. user_id
-- doubles as the automation workspace_id, matching the app convention.

CREATE TABLE IF NOT EXISTS shopify_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shop_domain TEXT NOT NULL,                 -- e.g. "vitalu.myshopify.com"
  shop_name TEXT,
  access_token TEXT NOT NULL,                -- encrypted (iv:ct:tag)
  scope TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'uninstalled', 'expired', 'error')),
  last_error TEXT,
  installed_at TIMESTAMPTZ DEFAULT NOW(),
  uninstalled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, shop_domain)
);

CREATE INDEX IF NOT EXISTS idx_shopify_connections_shop
  ON shopify_connections (shop_domain);

ALTER TABLE shopify_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own shopify connections" ON shopify_connections;
CREATE POLICY "Users can manage own shopify connections" ON shopify_connections
  FOR ALL USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS set_updated_at ON shopify_connections;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON shopify_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
