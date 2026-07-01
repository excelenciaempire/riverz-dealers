-- ============================================================
-- 093 — Proactive Instagram controls: emergency pause, daily cap, audit log.
--
-- Trust/control layer for a serious business: a global kill-switch to halt ALL
-- proactive Instagram DMs for a workspace at once, a durable per-workspace
-- daily cap (protects sender reputation + Meta rate limits), and an audit log
-- of every proactive DM sent (who/when/which campaign/text) for accountability.
-- ============================================================

CREATE TABLE IF NOT EXISTS ig_proactive_settings (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  -- Emergency stop: when true, NO proactive DM goes out (auto, batch or closer).
  paused BOOLEAN NOT NULL DEFAULT FALSE,
  -- Max proactive DMs per rolling 24h per workspace (0 = unlimited).
  daily_cap INTEGER NOT NULL DEFAULT 500,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ig_proactive_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members manage ig proactive settings" ON ig_proactive_settings;
CREATE POLICY "Members manage ig proactive settings" ON ig_proactive_settings FOR ALL
  USING (is_workspace_member(workspace_id))
  WITH CHECK (is_workspace_member(workspace_id));

CREATE TABLE IF NOT EXISTS ig_proactive_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id UUID,
  contact_id UUID,
  -- 'outreach' (real-time), 'batch' (cron), 'closer' (reply), 'approval' (human)
  kind TEXT NOT NULL,
  text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ig_proactive_log_ws_time
  ON ig_proactive_log (workspace_id, created_at DESC);

ALTER TABLE ig_proactive_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members read ig proactive log" ON ig_proactive_log;
CREATE POLICY "Members read ig proactive log" ON ig_proactive_log FOR SELECT
  USING (is_workspace_member(workspace_id));
