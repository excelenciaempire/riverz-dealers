-- ============================================================
-- 036: Canal en reglas de asignación
-- ============================================================
--
-- Agrega una columna `channel` a la tabla de reglas para poder
-- restringir cualquier tipo de regla (round_robin, by_tag, by_keyword)
-- a un canal específico de la bandeja unificada. NULL significa
-- "cualquiera" (el comportamiento previo).
--
-- Los valores válidos siguen la taxonomía de Channel en TS — no
-- enforce un CHECK aquí porque sms / futuros canales se irán sumando
-- y no queremos tener que hacer un ALTER cada vez.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS.

ALTER TABLE conversation_assignment_rules
  ADD COLUMN IF NOT EXISTS channel TEXT;

CREATE INDEX IF NOT EXISTS conversation_assignment_rules_channel_idx
  ON conversation_assignment_rules (workspace_id, is_active, channel, priority);

COMMENT ON COLUMN conversation_assignment_rules.channel IS
  'Canal al que aplica la regla. NULL = cualquiera. Migración 036.';
