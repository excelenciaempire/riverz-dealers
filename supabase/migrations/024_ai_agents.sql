-- ============================================================
-- 024: AI customer-service agents
-- ============================================================
-- An ai_agent is a 24/7 auto-responder bound to a workspace. Scope
-- decides whether the agent answers across every channel
-- ('workspace') or only on the subset listed in ai_agent_channels
-- ('channels'). Multiple agents can coexist; the resolver picks at
-- most one for any given inbound message based on scope + priority.

CREATE TABLE IF NOT EXISTS ai_agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT false,

  -- Behavior prompt
  persona TEXT NOT NULL DEFAULT '',
  knowledge TEXT,
  language TEXT NOT NULL DEFAULT 'es',
  tone TEXT NOT NULL DEFAULT 'friendly'
    CHECK (tone IN ('friendly', 'formal', 'casual', 'concise')),

  -- Limits
  max_response_chars INT NOT NULL DEFAULT 500,
  reply_delay_seconds INT NOT NULL DEFAULT 0,
  context_messages INT NOT NULL DEFAULT 10,

  -- Behavior toggles
  reply_when_assigned BOOLEAN NOT NULL DEFAULT false,
  reply_outside_hours BOOLEAN NOT NULL DEFAULT true,
  business_hours JSONB,
  escalate_keywords TEXT[] DEFAULT '{}'::TEXT[],
  escalate_after_messages INT,

  -- Provider config
  provider TEXT NOT NULL DEFAULT 'anthropic'
    CHECK (provider IN ('anthropic', 'openai')),
  model TEXT NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
  api_key_encrypted TEXT,

  -- Scope
  scope TEXT NOT NULL DEFAULT 'workspace'
    CHECK (scope IN ('workspace', 'channels')),
  priority INT NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_agents_workspace_active
  ON ai_agents(workspace_id, is_active) WHERE is_active = true;

CREATE OR REPLACE FUNCTION touch_ai_agents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ai_agents_touch ON ai_agents;
CREATE TRIGGER ai_agents_touch
  BEFORE UPDATE ON ai_agents
  FOR EACH ROW EXECUTE FUNCTION touch_ai_agents_updated_at();

ALTER TABLE ai_agents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members manage workspace ai_agents" ON ai_agents;
CREATE POLICY "Members manage workspace ai_agents" ON ai_agents FOR ALL
  USING (is_workspace_member(workspace_id))
  WITH CHECK (is_workspace_member(workspace_id));

-- Per-channel binding for scope='channels' agents.
CREATE TABLE IF NOT EXISTS ai_agent_channels (
  agent_id UUID NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  PRIMARY KEY (agent_id, channel)
);

ALTER TABLE ai_agent_channels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members manage ai_agent_channels" ON ai_agent_channels;
CREATE POLICY "Members manage ai_agent_channels" ON ai_agent_channels FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM ai_agents a
      WHERE a.id = ai_agent_channels.agent_id
        AND is_workspace_member(a.workspace_id)
    )
  );

-- Audit log + simple usage tracker. One row per dispatch attempt; the
-- /ai page reads aggregate counts straight off it.
CREATE TABLE IF NOT EXISTS ai_replies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  prompt_tokens INT,
  completion_tokens INT,
  status TEXT NOT NULL CHECK (status IN ('sent', 'skipped', 'failed')),
  skip_reason TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_replies_workspace_created
  ON ai_replies(workspace_id, created_at DESC);

ALTER TABLE ai_replies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members read workspace ai_replies" ON ai_replies;
CREATE POLICY "Members read workspace ai_replies" ON ai_replies FOR SELECT
  USING (is_workspace_member(workspace_id));
