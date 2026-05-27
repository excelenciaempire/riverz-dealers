-- 016_conversation_is_ad.sql
--
-- The inbox UI shows an "Anuncio" badge per conversation row. That
-- read needs to be cheap (rendered for every row in the list), so we
-- denormalise: when the inbox-writer ingests a comment with ad_id in
-- the webhook payload, it now flips conversations.is_ad as well as
-- comments_meta.is_ad. The list query then just selects this column.
--
-- TypeScript already references c.is_ad on Conversation rows; the
-- previous PR landed without the migration.
--
-- Defaults to false so backfill isn't needed — existing rows pre-
-- migration weren't ads. The inbox-writer is idempotent; the next
-- ad-comment ingest will set this correctly going forward.

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS is_ad BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_conversations_is_ad
  ON conversations(workspace_id, is_ad)
  WHERE is_ad = TRUE;
