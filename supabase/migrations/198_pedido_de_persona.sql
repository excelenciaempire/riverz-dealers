-- ============================================================
-- 198: motivo nuevo de escalamiento — lo pidió el visitante
-- ============================================================
-- Hasta ahora todos los motivos los decidía el sistema: una palabra clave, el
-- cupo de respuestas, un flujo, el cortacircuitos, una aprobación que no llegó,
-- o el propio agente reconociendo que no sabía. Faltaba el más obvio: que la
-- persona del otro lado apriete un botón y pida hablar con alguien.
--
-- Sin entrar al CHECK, el UPDATE falla entero y el pedido se pierde en
-- silencio: el visitante ve que apretó, y del lado del comercio no pasa nada.
--
-- Idempotente. Se aplica a mano por la Management API.

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
      'answer_gap',
      -- El visitante lo pidió con un botón, sin tener que adivinar la palabra
      -- mágica que dispara `escalation_keyword`.
      'visitor_request'
    ));
