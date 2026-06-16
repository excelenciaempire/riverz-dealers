-- ============================================================
-- 053: automation_logs.user_id NOT NULL → NULLABLE
-- ============================================================
--
-- The automations engine (src/lib/automations/engine.ts) only knows
-- workspace_id when it runs — it doesn't have the originating user_id
-- in scope, especially for cron-dispatched runs (cart recovery,
-- post-delivery feedback, re-engagement). The NOT NULL constraint on
-- automation_logs.user_id caused every cron-fired execution to die
-- on INSERT with `null value in column "user_id" violates not-null
-- constraint`, so the log row was never written and the automation
-- counters stayed at zero even when the message went out.
--
-- Drop the NOT NULL. The engine now opportunistically backfills the
-- column from workspaces.owner_id whenever it can resolve it, but
-- crons (and any future workspace-only dispatcher) are free to log
-- with user_id NULL.
--
-- RLS still narrows reads via user_id when present; workspace-scoped
-- policies cover the NULL case via the related automation row.
-- ============================================================

ALTER TABLE automation_logs ALTER COLUMN user_id DROP NOT NULL;

COMMENT ON COLUMN automation_logs.user_id IS
  'Originating auth.users.id when the engine can resolve it (e.g. via workspaces.owner_id). NULL for cron-dispatched executions that only know workspace_id. Don''t rely on this for tenant scoping — use workspace_id.';
