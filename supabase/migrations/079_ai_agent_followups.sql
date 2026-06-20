-- ============================================================
-- 079 — Smart AI follow-ups
-- ============================================================
--
-- Lets an AI agent send a context-aware follow-up when the customer
-- goes silent after we spoke last. Config lives on the agent so each
-- workspace/agent tunes it independently. State lives on the
-- conversation so the cron is idempotent and self-resetting (a new
-- customer reply starts a fresh follow-up streak).
--
-- Apply via the Supabase Management API (migrations are manual here).
-- Idempotent.
-- ============================================================

-- Per-agent config -------------------------------------------------
ALTER TABLE public.ai_agents
  ADD COLUMN IF NOT EXISTS followup_enabled boolean NOT NULL DEFAULT false,
  -- Horas de silencio del cliente (desde nuestro último mensaje) antes
  -- de enviar un follow-up. numeric admite fracciones para pruebas.
  ADD COLUMN IF NOT EXISTS followup_delay_hours numeric NOT NULL DEFAULT 24,
  -- Máximo de follow-ups por racha de silencio (anti-spam).
  ADD COLUMN IF NOT EXISTS followup_max_count integer NOT NULL DEFAULT 1;

-- Migration 078 revoked table-level SELECT on ai_agents from
-- `authenticated` and re-granted only specific columns. The new config
-- columns are non-secret, so add them to that grant (idempotent).
GRANT SELECT (followup_enabled, followup_delay_hours, followup_max_count)
  ON public.ai_agents TO authenticated;

-- Per-conversation follow-up state ---------------------------------
ALTER TABLE public.conversations
  -- Follow-ups enviados en la racha de silencio ACTUAL. Se "resetea"
  -- de forma lógica en el cron: si el cliente respondió después de
  -- followup_last_at, la racha vieja no cuenta.
  ADD COLUMN IF NOT EXISTS followup_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS followup_last_at timestamptz;

-- El cron busca conversaciones abiertas ordenadas por last_message_at.
CREATE INDEX IF NOT EXISTS idx_conversations_followup_candidates
  ON public.conversations (workspace_id, last_message_at)
  WHERE status = 'open';
