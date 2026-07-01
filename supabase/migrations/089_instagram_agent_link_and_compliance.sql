-- ============================================================
-- 089 — Instagram: one brain, compliant proactive controls.
--
-- Ties the outbound Instagram surfaces (campaigns + comment-to-DM rules) to the
-- SAME ai_agent that answers reactively, so there's one brand identity instead
-- of a second "agent". Adds a per-agent automation level (auto ↔ human
-- approval) and the plumbing to keep every proactive DM inside Meta policy:
-- a per-comment private-reply lock (one reply per comment across both systems)
-- and an approval queue on recipients.
-- ============================================================

-- 1. Link the outbound Instagram surfaces to the agent whose brand voice they
--    use. Default is resolved in code = the agent that owns the instagram
--    channel. ON DELETE SET NULL so removing an agent doesn't cascade-delete
--    campaigns/rules (they fall back to the "freshest active agent").
ALTER TABLE instagram_campaigns
  ADD COLUMN IF NOT EXISTS ai_agent_id UUID REFERENCES ai_agents(id) ON DELETE SET NULL;

ALTER TABLE comment_to_dm_rules
  ADD COLUMN IF NOT EXISTS ai_agent_id UUID REFERENCES ai_agents(id) ON DELETE SET NULL;

-- 2. Per-agent automation level for proactive Instagram DMs. Always compliant;
--    controls how much runs automatically vs. waits for human approval.
--    auto          : send automatically (within guardrails + opt-out + 24h window)
--    hybrid_intent : auto for clear high-intent leads, queue the rest for review
--    approval      : every proactive DM waits for human approval
ALTER TABLE ai_agents
  ADD COLUMN IF NOT EXISTS proactive_send_mode TEXT NOT NULL DEFAULT 'auto'
    CHECK (proactive_send_mode IN ('auto', 'hybrid_intent', 'approval'));

-- 3. Approval queue on recipients: the drafted DM held for review, plus the
--    source comment id so an approval can still be delivered as a private reply
--    (Meta allows one private reply per comment within ~7 days). Also widen the
--    status check with 'pending_review'.
ALTER TABLE instagram_campaign_recipients
  ADD COLUMN IF NOT EXISTS draft_text TEXT,
  ADD COLUMN IF NOT EXISTS source_comment_id TEXT;

ALTER TABLE instagram_campaign_recipients
  DROP CONSTRAINT IF EXISTS instagram_campaign_recipients_status_check;

ALTER TABLE instagram_campaign_recipients
  ADD CONSTRAINT instagram_campaign_recipients_status_check
    CHECK (status IN ('queued', 'pending_review', 'sent', 'replied', 'converted', 'skipped', 'failed'));

-- 4. One private reply per comment, across BOTH systems (comment-to-DM rules AND
--    campaign instant outreach). Whichever claims a comment first sends the
--    single private reply; the other skips. Meta permits only one per comment.
CREATE TABLE IF NOT EXISTS ig_private_reply_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  comment_external_id TEXT NOT NULL,
  claimed_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, comment_external_id)
);

-- Service-role only (written by the fire-and-forget ingest paths); no policies.
ALTER TABLE ig_private_reply_claims ENABLE ROW LEVEL SECURITY;
