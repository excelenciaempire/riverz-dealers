-- ============================================================
-- 092 — Click-to-WhatsApp (CTWA) ad referral on conversations.
--
-- When someone clicks a Click-to-WhatsApp ad (or an IG/FB ad routing to
-- WhatsApp) and messages the business, the WhatsApp webhook carries a
-- `referral` object (ad id, ctwa_clid, headline, source url). We stamp it on
-- the conversation ONCE so the same agent + enrichment know the origin, and so
-- attribution can tie a later sale back to the exact ad. Uses the WhatsApp
-- token already granted — no extra permission.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ad_referral JSONB;
