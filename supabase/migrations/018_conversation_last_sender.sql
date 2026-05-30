-- Tracks the sender type of the most recent message in each
-- conversation so the inbox row can show its "unreplied" dot without
-- a per-row messages query. Updated by inbox-writer on every inbound
-- ingest and by the send route on every outbound — and backfilled
-- below from the latest message we already have.

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS last_sender_type TEXT;

-- Backfill: stamp each conversation with the sender_type of its newest
-- message. Uses DISTINCT ON over messages ordered by created_at so we
-- pick the most recent per conversation in a single pass.
UPDATE conversations c
SET last_sender_type = m.sender_type
FROM (
  SELECT DISTINCT ON (conversation_id)
    conversation_id, sender_type
  FROM messages
  ORDER BY conversation_id, created_at DESC
) m
WHERE m.conversation_id = c.id
  AND c.last_sender_type IS DISTINCT FROM m.sender_type;
