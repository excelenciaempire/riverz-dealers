-- ============================================================
-- 077 — Per-workspace AI checkout config
-- ============================================================
--
-- Context: the `create_checkout` AI tool (src/lib/shopify/create-checkout.ts)
-- used to hardcode the entire Pilar Argentina economy — shop domain allow-
-- list, the 1u / 2u_1_gratis / 3u_1_gratis offer enum, ARS prices, compare-at
-- prices, the $4.900 transfer discount, and a literal Sérum variant id. That
-- made the checkout a single-tenant feature.
--
-- This table moves that config per-workspace so EVERY Shopify-connected
-- workspace can use the checkout tool:
--
--   * BUNDLE MODE  — workspace has `offers` (a fixed set of bundle SKUs, each
--     with qty/total/compare_at). Behaves like Pilar does today: the tool
--     emits a cart-permalink with the bundle quantity and a curated total.
--   * AUTO MODE    — workspace has NO `offers`. The tool quotes the variant's
--     real Shopify price × quantity, no compare-at, no invented discounts.
--
-- Pilar is seeded below so its behavior stays byte-identical (BUNDLE MODE).
--
-- RLS mirrors 075_rls_least_privilege.sql: member SELECT via
-- is_workspace_member(workspace_id), admin writes via
-- is_workspace_admin(workspace_id). Helpers come from 013_unified_inbox.sql
-- (search_path pinned in 064). Idempotent (DROP POLICY IF EXISTS + CREATE,
-- ON CONFLICT DO NOTHING on the seed).
--
-- The AI runner reads this with the SERVICE-ROLE client (RLS-bypassing), so
-- the policies below only constrain the browser / cookie-client surface.
-- ============================================================

-- ── Preconditions: helpers must exist (defensive no-op assertion) ────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_workspace_member'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_workspace_admin'
  ) THEN
    RAISE EXCEPTION
      '077 requires is_workspace_member()/is_workspace_admin() (013_unified_inbox.sql). Apply 013 first.';
  END IF;
END $$;

-- ── Table ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_checkout_config (
  workspace_id            UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  enabled                 BOOLEAN NOT NULL DEFAULT true,
  currency                TEXT,
  -- offers: JSONB array of bundle offers. Each element:
  --   { "key": "2u_1_gratis", "label": "2 unidades + 1 gratis",
  --     "qty": 3, "total": 69900, "compare_at": 210000 }
  -- NULL / empty array => AUTO MODE (quote the variant's real price).
  offers                  JSONB,
  transfer_discount_amount NUMERIC,
  transfer_discount_label TEXT,
  payment_methods         TEXT[],
  -- default_variant_id: fallback Shopify variant id when no product was
  -- pinned from the customer's message (was the literal Pilar Sérum id).
  default_variant_id      TEXT,
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now()
);

-- ── RLS: member SELECT, admin writes (mirrors 075) ───────────────────
ALTER TABLE workspace_checkout_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_checkout_config_select ON workspace_checkout_config;
DROP POLICY IF EXISTS workspace_checkout_config_admin_write ON workspace_checkout_config;

CREATE POLICY workspace_checkout_config_select ON workspace_checkout_config
  FOR SELECT USING (is_workspace_member(workspace_id));

CREATE POLICY workspace_checkout_config_admin_write ON workspace_checkout_config
  FOR ALL
  USING (is_workspace_admin(workspace_id))
  WITH CHECK (is_workspace_admin(workspace_id));

-- ── Seed Pilar (keeps current behavior byte-identical) ───────────────
-- workspace_id is the live Pilar Argentina workspace. offers reproduce the
-- old OFFER_QUANTITY / OFFER_TOTAL_ARS / OFFER_COMPARE_ARS constants exactly;
-- default_variant_id is the old hardcoded Sérum fallback; the transfer
-- discount is the old $4.900 / "transferencia" pair.
INSERT INTO workspace_checkout_config (
  workspace_id,
  enabled,
  currency,
  default_variant_id,
  transfer_discount_amount,
  transfer_discount_label,
  payment_methods,
  offers
) SELECT
  '522a68ae-568d-4dd9-92e5-2c8f633f1761'::uuid,
  true,
  'ARS',
  '48310065791076',
  4900,
  'transferencia',
  ARRAY['card', 'mercado_pago'],
  '[
    {"key":"1u","label":"1 unidad","qty":1,"total":39990,"compare_at":70000},
    {"key":"2u_1_gratis","label":"2 unidades + 1 gratis","qty":3,"total":69900,"compare_at":210000},
    {"key":"3u_1_gratis","label":"3 unidades + 1 gratis","qty":4,"total":99900,"compare_at":280000}
  ]'::jsonb
WHERE EXISTS (
  SELECT 1 FROM workspaces WHERE id = '522a68ae-568d-4dd9-92e5-2c8f633f1761'::uuid
)
ON CONFLICT (workspace_id) DO NOTHING;
