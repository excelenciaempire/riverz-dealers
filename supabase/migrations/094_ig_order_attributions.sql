-- ============================================================
-- 094 — Instagram order-attribution ledger.
--
-- One queryable record of every order that happened THANKS TO the Instagram
-- engine, across sources: campaign conversions (attribution.ts, matched by
-- unique code or identity within the window), agent-created orders (the
-- create_order tool, for an IG contact), and later comment-to-DM / CTWA.
--
-- Unifies what today is scattered (revenue on recipients + rows in `orders`)
-- into a single "attributed to Instagram" ledger for reporting. Idempotent per
-- (workspace, order) so a given order is attributed once.
-- ============================================================

CREATE TABLE IF NOT EXISTS ig_order_attributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  shopify_order_id TEXT NOT NULL,
  order_name TEXT,
  -- 'campaign' | 'agent' | 'comment_to_dm' | 'ctwa'
  source TEXT NOT NULL,
  campaign_id UUID,
  contact_id UUID,
  channel TEXT,
  code TEXT,
  revenue NUMERIC(12, 2),
  currency TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (workspace_id, shopify_order_id)
);

CREATE INDEX IF NOT EXISTS idx_ig_order_attr_ws
  ON ig_order_attributions (workspace_id, created_at DESC);

ALTER TABLE ig_order_attributions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members read ig order attributions" ON ig_order_attributions;
CREATE POLICY "Members read ig order attributions" ON ig_order_attributions FOR SELECT
  USING (is_workspace_member(workspace_id));
