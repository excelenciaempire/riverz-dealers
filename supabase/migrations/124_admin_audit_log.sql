-- ============================================================
-- 124: Platform admin audit log
-- ============================================================
-- The /admin panel is read-only over merchant data, but "read-only" is not
-- the same as "unaccountable": the team can see every workspace on the
-- platform, so WHO looked at WHAT has to be recorded. This table is the only
-- write the panel makes about itself.
--
-- Append-only by convention (no UPDATE/DELETE path in the app). RLS enabled
-- with NO policies → service-role only; the /admin/auditoria page reads it
-- through the admin API, which is already platform-admin gated.
--
-- Apply MANUALLY via the Supabase Management API.
-- ============================================================

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id BIGSERIAL PRIMARY KEY,
  -- Email is stored alongside the id because the platform-admin allowlist
  -- lives in code/env, not in a table: the id alone would not tell us later
  -- who this was if the account is deleted.
  actor_id UUID,
  actor_email TEXT NOT NULL,
  -- Dotted verb, e.g. 'view.workspaces', 'view.workspace', 'update.feature_flag'.
  action TEXT NOT NULL,
  -- What it was about: 'workspace' | 'user' | 'feature_flag' | 'voice_model' | null.
  target_type TEXT,
  target_id TEXT,
  -- Free-form context (filters used, previous/new value…). Never PII of a
  -- merchant's end customer.
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The panel reads it newest-first, optionally narrowed to one actor.
CREATE INDEX IF NOT EXISTS admin_audit_log_created_at_idx
  ON admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_actor_idx
  ON admin_audit_log (actor_email, created_at DESC);

ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;
-- No policies: service-role only.
