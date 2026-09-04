-- Persistent evidence for template experiments. Configuration can change in an
-- automation step; these rows retain the exact variant that was actually sent.
CREATE TABLE IF NOT EXISTS automation_template_exposures (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  automation_id UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  automation_step_id UUID NOT NULL REFERENCES automation_steps(id) ON DELETE CASCADE,
  automation_log_id UUID REFERENCES automation_logs(id) ON DELETE SET NULL,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  experiment_id TEXT NOT NULL,
  variant_id TEXT NOT NULL CHECK (variant_id IN ('a', 'b')),
  template_name TEXT NOT NULL,
  whatsapp_message_id TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  response_at TIMESTAMPTZ,
  response_message_id TEXT UNIQUE,
  order_id UUID UNIQUE REFERENCES orders(id) ON DELETE SET NULL,
  order_total NUMERIC,
  order_currency TEXT,
  order_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ab_exposures_contact_recent
  ON automation_template_exposures (workspace_id, contact_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_ab_exposures_experiment
  ON automation_template_exposures (workspace_id, automation_step_id, experiment_id, sent_at DESC);

ALTER TABLE automation_template_exposures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "members read automation template experiments" ON automation_template_exposures;
CREATE POLICY "members read automation template experiments" ON automation_template_exposures
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM workspace_members wm
    WHERE wm.workspace_id = automation_template_exposures.workspace_id
      AND wm.user_id = auth.uid()
  ));
