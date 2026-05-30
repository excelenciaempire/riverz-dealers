-- ============================================================
-- 020: Campaign scheduling + inbox conversations
-- ============================================================
-- broadcasts already has scheduled_at + the 'scheduled' status (migration
-- 001). This adds:
--   - broadcasts.create_conversations: when true, sending also opens a
--     conversation thread per recipient in the unified inbox (the
--     "crear conversaciones en la Bandeja" toggle).
--   - broadcast_recipients.params: the per-recipient template variables,
--     resolved at schedule time so the cron sender doesn't need to
--     re-resolve the audience/variable mapping when a scheduled campaign
--     fires later.

ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS create_conversations BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE broadcast_recipients
  ADD COLUMN IF NOT EXISTS params JSONB;

-- The cron sender scans for due scheduled campaigns.
CREATE INDEX IF NOT EXISTS idx_broadcasts_scheduled
  ON broadcasts (status, scheduled_at)
  WHERE status = 'scheduled';
