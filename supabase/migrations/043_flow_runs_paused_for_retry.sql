-- ============================================================
-- 043: flow_runs status 'paused_for_retry' + retry pointer
-- ============================================================
--
-- send_buttons / send_list pueden fallar de forma transitoria (rate
-- limit de Meta, timeout, 5xx). El runner persiste un reintento en
-- flow_pending_retries (migración 038) y pausa el run con el nuevo
-- status 'paused_for_retry' para que el resto del runtime sepa que
-- el run está bloqueado esperando el reintento del cron, no a un
-- cliente.

ALTER TABLE flow_runs
  DROP CONSTRAINT IF EXISTS flow_runs_status_check;

ALTER TABLE flow_runs
  ADD CONSTRAINT flow_runs_status_check
  CHECK (status IN (
    'active',
    'completed',
    'handed_off',
    'timed_out',
    'paused_by_agent',
    'paused_for_retry',
    'failed'
  ));

-- Índice parcial para que el cron de retries pueda filtrar runs
-- pausados sin escanear toda la tabla.
CREATE INDEX IF NOT EXISTS idx_flow_runs_paused_for_retry
  ON flow_runs (id)
  WHERE status = 'paused_for_retry';

-- flow_pending_retries necesita rastrear qué hay que reintentar
-- (botones vs lista) para que el cron sepa qué send re-disparar.
ALTER TABLE flow_pending_retries
  ADD COLUMN IF NOT EXISTS retry_kind TEXT;

CREATE INDEX IF NOT EXISTS idx_flow_pending_retries_run_attempt
  ON flow_pending_retries (flow_run_id, attempt);
