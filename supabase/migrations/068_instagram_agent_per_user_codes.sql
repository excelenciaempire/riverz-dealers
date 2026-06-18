-- ============================================================
-- 068 — Instagram Agent: per-user discount codes.
--
-- Blueberry mints a UNIQUE discount code per person ("Code: Grace10") and
-- attributes the resulting order back to that exact recipient. We add the
-- columns to do the same:
--
--   instagram_campaigns.shopify_price_rule_id
--       The Shopify price rule that backs the campaign's offer. Created once
--       per campaign (percentage offers); every per-user code hangs off it.
--
--   instagram_campaign_recipients.discount_code
--       The unique code minted for and sent to this person. Used both in the
--       DM and for deterministic attribution (order used THIS code → THIS
--       recipient converted), independent of email/phone matching.
-- ============================================================

ALTER TABLE instagram_campaigns
  ADD COLUMN IF NOT EXISTS shopify_price_rule_id BIGINT;

ALTER TABLE instagram_campaign_recipients
  ADD COLUMN IF NOT EXISTS discount_code TEXT;

-- Fast lookup when matching an order's code back to its recipient.
CREATE INDEX IF NOT EXISTS idx_ig_recipients_discount_code
  ON instagram_campaign_recipients (campaign_id, discount_code)
  WHERE discount_code IS NOT NULL;
