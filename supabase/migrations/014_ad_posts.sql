-- ============================================================
-- ad_posts — cache mapping FB post_id → ad_id + campaign_id.
--
-- Meta's webhook `feed` payload does NOT reliably carry `ad_id` for
-- comments on ad creatives (including dark posts). We populate this
-- table from the Marketing API and join against it at ingest time so
-- the inbox can flag "comment on ad" reliably.
-- ============================================================

CREATE TABLE IF NOT EXISTS ad_posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES channel_connections(id) ON DELETE CASCADE,
  /** The "effective object story id" — the underlying page-scoped post
   * id of the ad creative. This is the field we cross-reference against
   * webhook payloads. */
  post_id TEXT NOT NULL,
  ad_id TEXT,
  adset_id TEXT,
  campaign_id TEXT,
  ad_account_id TEXT,
  ad_name TEXT,
  campaign_name TEXT,
  /** When `true` the post is an ad-only "dark post" (never published to
   * the page timeline). */
  is_dark_post BOOLEAN DEFAULT FALSE,
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (workspace_id, post_id)
);

CREATE INDEX IF NOT EXISTS idx_ad_posts_workspace ON ad_posts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_ad_posts_post ON ad_posts(post_id);

ALTER TABLE ad_posts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members can view ad_posts" ON ad_posts;
CREATE POLICY "Members can view ad_posts" ON ad_posts FOR SELECT
  USING (is_workspace_member(workspace_id));
DROP POLICY IF EXISTS "Service role manages ad_posts" ON ad_posts;
CREATE POLICY "Service role manages ad_posts" ON ad_posts FOR ALL WITH CHECK (true);

-- Convenience: comments_meta gets is_ad as a derived flag, refreshed
-- by the poller after it inserts/updates an ad_posts row.
ALTER TABLE comments_meta
  ADD COLUMN IF NOT EXISTS is_ad BOOLEAN DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_comments_meta_is_ad ON comments_meta(is_ad);
