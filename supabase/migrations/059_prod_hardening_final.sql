-- ============================================================
-- 059 — Final production hardening pass.
--
-- Consolidates many small additions used by the app-layer fixes
-- landed alongside this migration:
--
--   1. `shopify_claim_order_created` RPC for webhook idempotency
--      (orders/create dedupe, complements migration 056's
--      shopify_record_fulfillment_transition for orders/updated).
--
--   2. `shopify_webhook_deliveries` table for per-webhook-id
--      dedupe across orders/checkouts/customers receivers.
--
--   3. `channel_connections.status` adds 'expired' to the CHECK
--      constraint so the refresh/401 handlers can distinguish a
--      credential-needs-re-OAuth state from transient 'error' or
--      admin-initiated 'disconnected'. Mirrors shopify_connections.
--
--   4. Soft-delete columns on user-deletable parents
--      (flows / automations / ai_agents). Hard CASCADE used to
--      destroy historical flow_runs / automation_logs / etc.
--      Soft-delete preserves history; partial indexes filter the
--      hot-path queries.
--
--   5. Webhook event replay table (`webhook_events_raw`) so a
--      Supabase outage during processing doesn't silently lose
--      the event. The worker (broadcasts/cron is fine) replays
--      from this table.
--
--   6. Audit snapshot trigger on contacts: `BEFORE DELETE` copies
--      the contact's identity onto every audit row that references
--      it via FK SET NULL, so post-purge audit history is still
--      human-readable.
--
--   7. `flow_pending_executions` retry tracking (attempt counter +
--      last_error) so the resume cron uses exponential backoff
--      instead of marking everything 'failed' on first throw.
--
--   8. `shopify_checkouts` recovery retry tracking.
-- ============================================================

-- ── 1. Shopify orders/create dedupe RPC ─────────────────────
CREATE OR REPLACE FUNCTION shopify_claim_order_created(
  p_shop_domain TEXT,
  p_order_id BIGINT,
  p_fulfillment_status TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_rows INTEGER;
BEGIN
  INSERT INTO shopify_order_fulfillment_state(shop_domain, order_id, fulfillment_status)
  VALUES (p_shop_domain, p_order_id, p_fulfillment_status)
  ON CONFLICT (shop_domain, order_id) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;

-- ── 2. Per-webhook-id dedupe table ─────────────────────────
CREATE TABLE IF NOT EXISTS shopify_webhook_deliveries (
  shop_domain TEXT NOT NULL,
  webhook_id  TEXT NOT NULL,
  topic       TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (shop_domain, webhook_id)
);

CREATE INDEX IF NOT EXISTS shopify_webhook_deliveries_received_at_idx
  ON shopify_webhook_deliveries (received_at);

ALTER TABLE shopify_webhook_deliveries ENABLE ROW LEVEL SECURITY;
-- No user-facing policies — service-role only.

-- ── 3. channel_connections.status: add 'expired' ────────────
ALTER TABLE channel_connections
  DROP CONSTRAINT IF EXISTS channel_connections_status_check;

ALTER TABLE channel_connections
  ADD CONSTRAINT channel_connections_status_check
  CHECK (status IN ('connected','disconnected','error','pending','expired'));

-- ── 4. Soft-delete columns on parent entities ───────────────
ALTER TABLE flows       ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE automations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE ai_agents   ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_flows_deleted_at
  ON flows (deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_automations_deleted_at
  ON automations (deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ai_agents_deleted_at
  ON ai_agents (deleted_at) WHERE deleted_at IS NULL;

-- ── 5. Webhook event replay table ──────────────────────────
CREATE TABLE IF NOT EXISTS webhook_events_raw (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider     TEXT NOT NULL,
  raw_body     TEXT NOT NULL,
  signature    TEXT,
  headers      JSONB,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT
);

CREATE INDEX IF NOT EXISTS webhook_events_raw_pending_idx
  ON webhook_events_raw (received_at) WHERE processed_at IS NULL;

ALTER TABLE webhook_events_raw ENABLE ROW LEVEL SECURITY;
-- Service-role only.

-- ── 6. Contact-delete audit snapshot trigger ─────────────────
ALTER TABLE broadcast_recipients
  ADD COLUMN IF NOT EXISTS contact_phone_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS contact_name_snapshot  TEXT;

ALTER TABLE automation_logs
  ADD COLUMN IF NOT EXISTS contact_phone_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS contact_name_snapshot  TEXT;

CREATE OR REPLACE FUNCTION snapshot_contact_on_delete()
RETURNS TRIGGER AS $$
BEGIN
  -- Copy the contact's identifying fields onto every audit row that
  -- references it via FK SET NULL — so a GDPR-style purge preserves
  -- "we sent this to +57…" without preserving the actual contact row.
  UPDATE broadcast_recipients
     SET contact_phone_snapshot = OLD.phone,
         contact_name_snapshot  = OLD.name
   WHERE contact_id = OLD.id
     AND contact_phone_snapshot IS NULL;

  UPDATE automation_logs
     SET contact_phone_snapshot = OLD.phone,
         contact_name_snapshot  = OLD.name
   WHERE contact_id = OLD.id
     AND contact_phone_snapshot IS NULL;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS contacts_audit_snapshot ON contacts;
CREATE TRIGGER contacts_audit_snapshot
  BEFORE DELETE ON contacts
  FOR EACH ROW EXECUTE FUNCTION snapshot_contact_on_delete();

-- ── 7. Flow pending retry tracking ───────────────────────────
ALTER TABLE flow_pending_executions
  ADD COLUMN IF NOT EXISTS attempt INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS last_error TEXT;

-- ── 8. Shopify cart-recovery retry tracking ──────────────────
ALTER TABLE shopify_checkouts
  ADD COLUMN IF NOT EXISTS recovery_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recovery_last_error TEXT;

-- ── 9. Cron heartbeat / observability ────────────────────────
CREATE TABLE IF NOT EXISTS cron_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at  TIMESTAMPTZ,
  status       TEXT NOT NULL DEFAULT 'running'
                 CHECK (status IN ('running','ok','error')),
  duration_ms  INTEGER,
  error        TEXT,
  payload      JSONB
);

CREATE INDEX IF NOT EXISTS cron_runs_name_started_at_idx
  ON cron_runs (name, started_at DESC);

ALTER TABLE cron_runs ENABLE ROW LEVEL SECURITY;
-- Service-role only.
