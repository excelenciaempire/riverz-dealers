-- ============================================================
-- 038: flow_pending_retries — cola de reintentos del runner
-- ============================================================
--
-- Cuando un nodo del flow falla por causa transitoria (http_fetch
-- timeout, send_message rate-limited, etc.) el runner persiste un
-- reintento aquí con backoff. Un cron periódico levanta filas con
-- run_at <= now() y attempt < max_attempts.

CREATE TABLE IF NOT EXISTS flow_pending_retries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_run_id UUID REFERENCES flow_runs(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  node_key TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_flow_pending_retries_run_at
  ON flow_pending_retries (run_at);

ALTER TABLE flow_pending_retries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace members" ON flow_pending_retries;
CREATE POLICY "workspace members" ON flow_pending_retries
  FOR ALL
  USING (is_workspace_member(workspace_id))
  WITH CHECK (is_workspace_member(workspace_id));
