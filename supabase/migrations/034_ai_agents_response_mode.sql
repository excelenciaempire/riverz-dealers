-- ============================================================
-- 034: ai_agents — modo de respuesta + debounce de inbound
-- ============================================================
--
-- response_mode: define si el asistente responde con un solo bubble,
-- múltiples bubbles separados por \n\n, o decide dinámicamente según
-- el largo de su respuesta.
--
--   - single   (default): un solo mensaje. Comportamiento histórico.
--   - multi: el system prompt instruye al modelo a separar ideas con
--     \n\n y el runner manda cada chunk como mensaje aparte, con un
--     pequeño delay para simular conversación natural.
--   - dynamic: el modelo decide. Para respuestas cortas (< 280 chars),
--     manda uno solo; para largas, las parte donde tenga sentido.
--
-- inbound_debounce_seconds: cuántos segundos espera el runner ANTES
-- de generar la respuesta. Si llega otro mensaje del cliente durante
-- esa espera, el runner actual se cancela porque va a haber otro
-- runner (el del mensaje nuevo) que cubre todo. Sirve para que la IA
-- conteste UNA vez a un cliente que mandó 3 mensajes seguidos en vez
-- de generar 3 réplicas inconexas.
-- 0 = desactivado.

ALTER TABLE ai_agents
  ADD COLUMN IF NOT EXISTS response_mode TEXT NOT NULL DEFAULT 'single'
    CHECK (response_mode IN ('single', 'multi', 'dynamic'));

ALTER TABLE ai_agents
  ADD COLUMN IF NOT EXISTS inbound_debounce_seconds INTEGER NOT NULL DEFAULT 0
    CHECK (inbound_debounce_seconds >= 0 AND inbound_debounce_seconds <= 60);

COMMENT ON COLUMN ai_agents.response_mode IS
  'single | multi | dynamic. Migration 034.';
COMMENT ON COLUMN ai_agents.inbound_debounce_seconds IS
  'Segundos a esperar tras un inbound antes de generar la respuesta. Si llega otro inbound durante la espera, este runner se cancela. Migration 034.';
