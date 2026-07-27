-- ============================================================
-- 122: "necesita humano" visible en la bandeja
-- ============================================================
-- El escalamiento (palabra clave, cupo de respuestas agotado, nodo
-- `handoff` de un flujo) apagaba la IA y dejaba la conversación en
-- 'pending', pero NADIE podía encontrarla: 'pending' sólo existía como
-- opción de un selector dentro del chat, sin filtro ni señal en la lista.
-- El cliente quedaba esperando y el equipo sin enterarse.
--
-- Guardamos POR QUÉ escaló y CUÁNDO, para poder filtrarlas y para que la
-- persona que la toma sepa qué pasó sin leer todo el hilo.

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS needs_human_reason TEXT
    CHECK (needs_human_reason IS NULL OR needs_human_reason IN (
      -- El cliente escribió una de las palabras clave del agente.
      'escalation_keyword',
      -- El agente agotó su cupo de respuestas para este hilo.
      'escalate_after_messages',
      -- Un flujo llegó a un nodo de traspaso a humano.
      'flow_handoff'
    )),
  ADD COLUMN IF NOT EXISTS needs_human_at TIMESTAMPTZ;

COMMENT ON COLUMN conversations.needs_human_reason IS
  'Por qué la IA dejó el hilo a una persona. NULL = no escaló.';

-- Filtro "Necesita humano" de la bandeja: índice parcial, sólo sobre las
-- pocas filas escaladas.
CREATE INDEX IF NOT EXISTS idx_conversations_needs_human
  ON conversations(workspace_id, needs_human_at DESC)
  WHERE needs_human_reason IS NOT NULL;
