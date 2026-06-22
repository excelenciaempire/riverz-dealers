-- ============================================================
-- 086: Comentario → DM (auto-DM on Instagram/Facebook comments)
-- ============================================================
--
-- ManyChat's signature growth tool, brought to Riverz. When someone
-- comments on an IG/FB post or ad and the comment matches a rule's
-- keywords (or the rule has no keywords = any comment), we:
--   1. optionally post a PUBLIC reply on the comment, and
--   2. send a PRIVATE DM (a Meta "private reply" keyed by comment id —
--      the only way to DM someone who only commented; we don't have
--      their PSID/IGSID until they reply).
--
-- The DM send paths already exist in the channel adapters
-- (`recipient: { comment_id }`); this migration adds the rule storage
-- and an idempotency/analytics log. The engine lives in
-- `src/lib/comment-to-dm/engine.ts` and is fired from inbox-writer on
-- every inbound comment.

-- ── Rules ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS comment_to_dm_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- Which comment surface this rule watches.
  channel TEXT NOT NULL CHECK (channel IN ('ig_comment', 'fb_comment')),
  -- Limit to one post/ad, or NULL = ANY post on that channel.
  post_id TEXT,
  -- Trigger keywords. EMPTY array = match ANY comment on the post.
  keywords TEXT[] NOT NULL DEFAULT '{}',
  -- 'contains' (substring) or 'exact' (whole-comment) match.
  match_type TEXT NOT NULL DEFAULT 'contains'
    CHECK (match_type IN ('contains', 'exact')),
  case_sensitive BOOLEAN NOT NULL DEFAULT false,
  -- Public reply on the comment itself (rotated across templates to
  -- look human / avoid spam heuristics). Empty = no public reply.
  public_reply_enabled BOOLEAN NOT NULL DEFAULT true,
  public_reply_templates TEXT[] NOT NULL DEFAULT '{}',
  -- The private DM. `dm_message` is required; the button is appended as
  -- a link (private replies are text-only — no rich buttons).
  dm_message TEXT NOT NULL,
  dm_button_label TEXT,
  dm_button_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  -- First match wins when several rules could fire on one comment.
  priority INTEGER NOT NULL DEFAULT 100,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS comment_to_dm_rules_ws_channel_idx
  ON comment_to_dm_rules (workspace_id, channel, is_active, priority);

ALTER TABLE comment_to_dm_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS c2dm_rules_select ON comment_to_dm_rules;
CREATE POLICY c2dm_rules_select ON comment_to_dm_rules
  FOR SELECT USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS c2dm_rules_modify ON comment_to_dm_rules;
CREATE POLICY c2dm_rules_modify ON comment_to_dm_rules
  FOR ALL USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- ── Log (idempotency + analytics) ──────────────────────────
-- One row per (rule, comment). The UNIQUE constraint is the idempotency
-- guard: a duplicate webhook delivery for the same comment can't send a
-- second DM. Counts for the UI are derived from this table.
CREATE TABLE IF NOT EXISTS comment_to_dm_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES comment_to_dm_rules(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id UUID,
  comment_external_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  public_reply_status TEXT,        -- sent | failed | skipped
  public_reply_external_id TEXT,
  dm_status TEXT,                  -- sent | failed
  dm_external_id TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rule_id, comment_external_id)
);

CREATE INDEX IF NOT EXISTS comment_to_dm_log_rule_idx
  ON comment_to_dm_log (rule_id, created_at DESC);
CREATE INDEX IF NOT EXISTS comment_to_dm_log_ws_idx
  ON comment_to_dm_log (workspace_id, created_at DESC);

ALTER TABLE comment_to_dm_log ENABLE ROW LEVEL SECURITY;

-- Read-only to members; all writes go through the service role (the
-- engine runs in the webhook with no user session).
DROP POLICY IF EXISTS c2dm_log_select ON comment_to_dm_log;
CREATE POLICY c2dm_log_select ON comment_to_dm_log
  FOR SELECT USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

COMMENT ON TABLE comment_to_dm_rules IS
  'Auto-DM-on-comment (ManyChat-style) rules. Migration 086.';
COMMENT ON TABLE comment_to_dm_log IS
  'Per-comment idempotency + analytics for comment-to-DM. Migration 086.';
