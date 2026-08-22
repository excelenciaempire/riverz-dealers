-- ============================================================
-- 182: motivo nuevo de escalamiento — el agente no supo
-- ============================================================
-- Cuando el agente reconoce que le falta un dato, anota la pregunta y le pasa
-- el hilo a una persona. Ese motivo necesita entrar al CHECK o el UPDATE falla
-- y la conversacion queda sin marcar: la clienta esperando una respuesta que el
-- agente ya dijo que no tiene.

ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_needs_human_reason_check;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_needs_human_reason_check
    CHECK (needs_human_reason IS NULL OR needs_human_reason IN (
      'escalation_keyword',
      'escalate_after_messages',
      'flow_handoff',
      'reply_burst_guard',
      'approval_unnotified',
      -- El agente reconocio que no sabia la respuesta.
      'answer_gap'
    ));
