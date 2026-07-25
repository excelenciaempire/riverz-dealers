-- Per-comment OWNING connection.
--
-- FB/IG comments group into ONE conversation per (contact, channel), so a
-- commenter who comments on posts from TWO of a workspace's IG/FB accounts
-- collapses into a single conversation owned by whichever account they hit
-- first. Attributing a reply by conversation.connection_id then sends the reply
-- through the WRONG account's page token (fails, or replies as the wrong page).
-- Stamp each comment with the connection that actually received it so the
-- IG-agent public reply + comment moderation target the right account.
ALTER TABLE comments_meta
  ADD COLUMN IF NOT EXISTS connection_id uuid
    REFERENCES channel_connections(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_comments_meta_connection
  ON comments_meta(connection_id);
