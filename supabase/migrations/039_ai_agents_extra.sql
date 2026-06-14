-- ============================================================
-- 039: ai_agents — horario laboral estructurado + escalation guard
-- ============================================================
--
-- business_hours_* reemplaza el JSONB suelto por columnas tipadas
-- que el resolver puede chequear sin parsear JSON en cada inbound.
-- business_hours_days usa ISO-8601 (1 = lunes, 7 = domingo).
--
-- escalate_after_messages ya existía como INT nullable; lo
-- normalizamos a NOT NULL DEFAULT 0 con CHECK >= 0. 0 = no escalar
-- nunca por conteo.

ALTER TABLE ai_agents
  ADD COLUMN IF NOT EXISTS business_hours_start TIME,
  ADD COLUMN IF NOT EXISTS business_hours_end TIME,
  ADD COLUMN IF NOT EXISTS business_hours_timezone TEXT,
  ADD COLUMN IF NOT EXISTS business_hours_days INTEGER[];

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_agents' AND column_name = 'escalate_after_messages'
  ) THEN
    ALTER TABLE ai_agents
      ADD COLUMN escalate_after_messages INTEGER NOT NULL DEFAULT 0
        CHECK (escalate_after_messages >= 0);
  ELSE
    UPDATE ai_agents SET escalate_after_messages = 0 WHERE escalate_after_messages IS NULL;
    ALTER TABLE ai_agents ALTER COLUMN escalate_after_messages SET DEFAULT 0;
    ALTER TABLE ai_agents ALTER COLUMN escalate_after_messages SET NOT NULL;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'ai_agents_escalate_after_messages_check'
    ) THEN
      ALTER TABLE ai_agents
        ADD CONSTRAINT ai_agents_escalate_after_messages_check
        CHECK (escalate_after_messages >= 0);
    END IF;
  END IF;
END $$;
