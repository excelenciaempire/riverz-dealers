-- ============================================================
-- 026: Flows v2 — Shopify-tuned node types + wait infrastructure
-- ============================================================
-- Extends the v1 flow_nodes.node_type CHECK constraint with the node
-- types needed for the Shopify-first ManyChat parity:
--
--   send_image      → Cloud API image message
--   send_video      → Cloud API video message
--   send_document   → Cloud API document message
--   send_cta_url    → Cloud API interactive cta_url (one tap-to-open URL button)
--   wait            → suspend the run until N minutes/hours have passed
--   ai_intent       → invoke the workspace AI agent to classify the next
--                     inbound reply, route on the returned intent label
--   shopify_lookup  → query the connected Shopify store (order by number/email,
--                     customer profile, product by handle) and stash result in vars
--
-- flow_pending_executions backs the new `wait` node: the engine inserts
-- a row when the flow hits a wait, and a cron sweep resumes runs whose
-- run_at is past. Mirrors automation_pending_executions from migration 007.

ALTER TABLE flow_nodes
  DROP CONSTRAINT IF EXISTS flow_nodes_node_type_check;

ALTER TABLE flow_nodes
  ADD CONSTRAINT flow_nodes_node_type_check
  CHECK (node_type IN (
    'start',
    'send_message',
    'send_buttons',
    'send_list',
    'send_image',
    'send_video',
    'send_document',
    'send_cta_url',
    'collect_input',
    'condition',
    'set_tag',
    'handoff',
    'http_fetch',
    'wait',
    'ai_intent',
    'shopify_lookup',
    'end'
  ));

CREATE TABLE IF NOT EXISTS flow_pending_executions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flow_run_id UUID NOT NULL REFERENCES flow_runs(id) ON DELETE CASCADE,
  next_node_key TEXT NOT NULL,
  run_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_flow_pending_due
  ON flow_pending_executions(run_at)
  WHERE status = 'pending';

ALTER TABLE flow_pending_executions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members read pending via flow_runs" ON flow_pending_executions;
CREATE POLICY "Members read pending via flow_runs" ON flow_pending_executions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM flow_runs r
      WHERE r.id = flow_pending_executions.flow_run_id
        AND is_workspace_member(r.workspace_id)
    )
  );
