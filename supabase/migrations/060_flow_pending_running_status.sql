-- ============================================================
-- 060 — Fix flow_pending_executions status CHECK.
--
-- The flows-resume cron (src/app/api/cron/flows-resume/route.ts) claims
-- a due row with a two-step UPDATE to status='running' (filtered by
-- 'pending') to prevent double-processing under overlapping invocations
-- — the same pattern automation_pending_executions uses. But the CHECK
-- created in migration 026 only allowed ('pending','done','failed'), so
-- the 'running' UPDATE was rejected by the constraint, the cron read the
-- error as "lost the race" (it ignores the error and `continue`s), and
-- EVERY due row was skipped. Net effect: flow `wait` nodes never resumed.
--
-- This widens the CHECK to include 'running' so the claim succeeds and
-- the resume path (including migration 059's retry/backoff columns) runs.
-- Mirrors automation_pending_executions (migration 006).
-- ============================================================

ALTER TABLE flow_pending_executions
  DROP CONSTRAINT IF EXISTS flow_pending_executions_status_check;

ALTER TABLE flow_pending_executions
  ADD CONSTRAINT flow_pending_executions_status_check
  CHECK (status IN ('pending', 'running', 'done', 'failed'));
