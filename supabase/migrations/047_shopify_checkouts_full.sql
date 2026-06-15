-- ============================================================
-- 047: shopify_checkouts — captura completa de checkouts/abandoned carts
-- ============================================================
--
-- Hasta migration 046, los webhooks de Shopify (checkouts/create) solo
-- empujaban variables al automation engine y se olvidaban del payload.
-- Si la automatización fallaba o estaba pausada, perdíamos el recovery
-- URL para siempre y no quedaba historial de carritos abandonados.
--
-- Esta tabla persiste cada checkout completo: contenido del carrito,
-- email/teléfono, URL de recuperación, estado de completado. Sirve como:
--   1) Source of truth para recuperación de carritos abandonados.
--   2) Historial para analítica (cuántos abandonan, qué productos).
--   3) Fallback si la automatización no corre.
--
-- Key (shop_domain, checkout_id) refleja el id de Shopify (token) para
-- poder upsertear desde checkouts/create y checkouts/update sin
-- duplicar filas.

CREATE TABLE IF NOT EXISTS shopify_checkouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  shop_domain TEXT NOT NULL,
  checkout_id TEXT NOT NULL,
  customer_email TEXT,
  customer_phone TEXT,
  customer_name TEXT,
  total_price NUMERIC(12, 2),
  currency TEXT,
  line_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  abandoned_checkout_url TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT shopify_checkouts_unique_checkout
    UNIQUE (shop_domain, checkout_id)
);

CREATE INDEX IF NOT EXISTS idx_shopify_checkouts_workspace_open
  ON shopify_checkouts (workspace_id, completed_at)
  WHERE completed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_shopify_checkouts_created_at
  ON shopify_checkouts (created_at DESC);

ALTER TABLE shopify_checkouts ENABLE ROW LEVEL SECURITY;

-- Workspace members pueden leer sus propios checkouts (para mostrar
-- historial / dashboard de carritos abandonados). Las escrituras son
-- service-role-only via supabaseAdmin() desde el webhook.
DROP POLICY IF EXISTS "members read checkouts" ON shopify_checkouts;
CREATE POLICY "members read checkouts" ON shopify_checkouts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = shopify_checkouts.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "service role writes checkouts" ON shopify_checkouts;
CREATE POLICY "service role writes checkouts" ON shopify_checkouts
  FOR ALL USING (false);

COMMENT ON TABLE shopify_checkouts IS
  'Snapshot completo de cada checkout/abandoned cart de Shopify. Persistido por el webhook checkouts/create + checkouts/update. Sirve como fuente de verdad para recuperación de carritos y analítica de abandono.';

COMMENT ON COLUMN shopify_checkouts.status IS
  'open = carrito abierto, completed = checkout convertido a orden, expired = expiró sin completar.';

COMMENT ON COLUMN shopify_checkouts.line_items IS
  'Array JSON crudo de line_items del checkout: title, quantity, price, variant_id, product_id, image_url.';
