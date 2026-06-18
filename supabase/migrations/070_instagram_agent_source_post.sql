-- ============================================================
-- 070 — Instagram Agent: source post for per-post ROI.
--
-- Blueberry shows "which posts, comments and DMs drive revenue". When the
-- real-time trigger enrolls someone who engaged with a specific post, we
-- record that post id so attributed revenue can be rolled up per source post
-- ("this reel generated $X").
--
--   instagram_campaign_recipients.source_post_id
--       The Instagram post/media id the engagement came from (when known —
--       set by the real-time comment trigger). NULL for batch-resolved
--       recipients where the originating post isn't known.
-- ============================================================

ALTER TABLE instagram_campaign_recipients
  ADD COLUMN IF NOT EXISTS source_post_id TEXT;

CREATE INDEX IF NOT EXISTS idx_ig_recipients_source_post
  ON instagram_campaign_recipients (campaign_id, source_post_id)
  WHERE source_post_id IS NOT NULL;
