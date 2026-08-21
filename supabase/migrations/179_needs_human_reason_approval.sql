-- ============================================================
-- 179: motivo nuevo de escalamiento — la aprobación que nadie recibió
-- ============================================================
-- Cuando el agente deja pedida una cancelación o un reembolso, la fila
-- queda esperando en el panel y al comercio le sale un WhatsApp. Si ese
-- aviso NO sale —sin teléfono cargado, o Meta rechazando el envío— la
-- clienta ya escuchó "te confirmo en breve" y del otro lado no se enteró
-- nadie: el hilo tiene que quedar marcado para que lo mire una persona.
--
-- Ese motivo necesita entrar al CHECK de la migración 122, o el UPDATE
-- falla y la conversación queda sin marcar. Es exactamente el silencio
-- que la 178 vino a evitar, y la primera versión de esta marca escribía
-- texto libre: habría fallado siempre, justo en el caso para el que se
-- agregó.

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
      'reply_burst_guard',
      -- Hay una cancelación o un reembolso pedido que el comercio nunca
      -- recibió por WhatsApp.
      'approval_unnotified'
    ));
