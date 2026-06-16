-- ============================================================
-- 054: broadcasts.error_message
-- ============================================================
-- The broadcast cron now marks legacy broadcasts that fail
-- workspace-scope resolution as `failed` with a human-readable
-- reason instead of silently flipping them to `sent`. Match the
-- existing pattern on `broadcast_recipients.error_message` so the
-- UI can surface why a campaign didn't go out.

ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS error_message TEXT;
