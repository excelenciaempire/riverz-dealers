-- ============================================================
-- 116: Voice AI — COD write-back analytics + voice campaigns + Dropi
-- ============================================================
-- 1) voice_calls: city (per-city analytics) + upsell_amount (in-call upsell revenue).
-- 2) voice_campaigns: bulk outbound call campaigns over a segment.
-- 3) dropi_connections: per-workspace Dropi (COD fulfillment) credentials.
-- COD config (order_writeback / dedupe_hours / cod_mode) lives in
--   channel_connections(voice).config JSONB — no columns here.
-- Upsell config lives in ai_agents.voice_objectives.order_confirmation.upsell.
-- Apply MANUALLY via the Supabase Management API.
-- ============================================================

ALTER TABLE voice_calls
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS upsell_amount NUMERIC;

CREATE TABLE IF NOT EXISTS voice_campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  segment_id UUID REFERENCES contact_segments(id) ON DELETE SET NULL,
  call_type TEXT NOT NULL DEFAULT 'manual',
  objective TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','running','paused','done','canceled')),
  scheduled_at TIMESTAMPTZ,
  -- Progress cursor + counters: { total, enqueued, last_contact_id, done }
  stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_voice_campaigns_ws ON voice_campaigns(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_voice_campaigns_run ON voice_campaigns(status) WHERE status = 'running';
ALTER TABLE voice_campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members read voice_campaigns" ON voice_campaigns;
CREATE POLICY "Members read voice_campaigns" ON voice_campaigns FOR SELECT
  USING (is_workspace_member(workspace_id));
DROP POLICY IF EXISTS "Members write voice_campaigns" ON voice_campaigns;
CREATE POLICY "Members write voice_campaigns" ON voice_campaigns FOR ALL
  USING (is_workspace_member(workspace_id))
  WITH CHECK (is_workspace_member(workspace_id));

CREATE TABLE IF NOT EXISTS dropi_connections (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  api_key_encrypted TEXT,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'connected',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE dropi_connections ENABLE ROW LEVEL SECURITY;
-- Read for members (never exposes the key — the API returns has_key only);
-- writes only via service role (the /api/integrations/dropi route).
DROP POLICY IF EXISTS "Members read dropi" ON dropi_connections;
CREATE POLICY "Members read dropi" ON dropi_connections FOR SELECT
  USING (is_workspace_member(workspace_id));
