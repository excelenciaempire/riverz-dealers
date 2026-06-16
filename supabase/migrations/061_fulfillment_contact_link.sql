-- ============================================================
-- 061 — Link fulfillment-state rows to the contact they belong to.
--
-- The post-delivery feedback cron (api/cron/shopify-feedback) needs to
-- message the customer who received THIS order. The fulfillment-state
-- row had no contact reference, so the cron fell back to "the most
-- recent shopify_order_fulfilled log in the whole workspace" — which,
-- with more than one fulfillment in flight, targets the wrong customer.
--
-- We add contact_id and have the orders webhook stamp it whenever it
-- upserts the contact for an order (create + fulfilled). The cron then
-- reads it directly per (shop_domain, order_id). FK is SET NULL so a
-- GDPR contact purge doesn't orphan the row (the audit snapshot trigger
-- from 059 already preserves identity elsewhere).
-- ============================================================

ALTER TABLE shopify_order_fulfillment_state
  ADD COLUMN IF NOT EXISTS contact_id UUID
    REFERENCES contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_shopify_fulfillment_contact
  ON shopify_order_fulfillment_state (contact_id)
  WHERE contact_id IS NOT NULL;
