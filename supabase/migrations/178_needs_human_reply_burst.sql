-- ============================================================
-- 178: motivo nuevo de escalamiento — cortacircuitos de ráfaga
-- ============================================================
-- El 20 de agosto de 2026 el agente entró en un bucle con el robot de
-- Outlook: contestó un boletín de un `noreply@`, el correo rebotó, y
-- contestó el rebote. Cuatro horas y 549 correos después, Microsoft
-- bloqueó la casilla del comercio por pasarse del límite diario.
--
-- El fusible que se agregó (BURST_MAX_REPLIES en src/lib/ai/types.ts)
-- apaga la IA del hilo y lo deja para una persona. Ese motivo necesita
-- entrar al CHECK de la migración 122, o el UPDATE falla y la
-- conversación queda sin marcar — el mismo silencio que costó caro.

ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_needs_human_reason_check;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_needs_human_reason_check
    CHECK (needs_human_reason IS NULL OR needs_human_reason IN (
      -- El cliente escribió una de las palabras clave del agente.
      'escalation_keyword',
      -- El agente agotó su cupo de respuestas para este hilo.
      'escalate_after_messages',
      -- Un flujo llegó a un nodo de traspaso a humano.
      'flow_handoff',
      -- Demasiados mensajes al mismo contacto en poco tiempo: algo se
      -- trabó y del otro lado no hay una persona.
      'reply_burst_guard'
    ));
