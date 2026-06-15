-- ============================================================
-- Workspaces soft delete.
--
-- Adds a deleted_at marker so a workspace can be hidden from the UI
-- without losing the underlying data. Hard PII purge runs separately
-- (operator script, not yet wired) — this column is the trigger.
-- Idempotent: safe to re-run.
-- ============================================================

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_workspaces_deleted_at
  ON workspaces (deleted_at)
  WHERE deleted_at IS NULL;
