-- ============================================================
-- 231 - Un problema en curso no es un pedido de hablar con una persona
-- ============================================================
--
-- La CHECK de `conversations.needs_human_reason` llegaba a doce valores. Falta
-- uno, y falta porque el runner venia usando el motivo equivocado.
--
-- `escalation_keyword` significa una sola cosa: la persona pidio hablar con
-- alguien. La bandeja lo escribe literal arriba del hilo -- "El cliente pidio
-- hablar con una persona" -- y el panel de escalaciones agrupa por ahi.
--
-- Pero el runner lo usaba tambien para el OTRO camino: el triaje de
-- lib/ai/escalada.ts, que escala cuando ve un problema real en curso (el envio
-- va a otra ciudad, llego roto o distinto, pago y no figura el pedido). En esos
-- casos nadie pidio nada.
--
-- El 2026-08-30, workspace Pilar, Instagram: una clienta reclamo que el producto
-- se veia falso. El hilo quedo marcado como si hubiera pedido un humano, y el
-- resumen de traspaso citaba, como si fuera ese pedido, el volcado de su
-- direccion. Quien abrio el caso leyo dos cosas falsas antes de leer una
-- verdadera.
--
-- La lista sale de NEEDS_HUMAN_REASONS en src/types/index.ts y
-- escalada-y-base.test.ts compara las dos: es la unica forma de que no se
-- vuelvan a separar.
--
-- Aplicada A MANO por la Management API (no corre en el deploy de Render).
-- ============================================================

ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_needs_human_reason_check;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_needs_human_reason_check
  CHECK (
    needs_human_reason IS NULL OR needs_human_reason IN (
    'escalation_keyword',
    'escalate_after_messages',
    'flow_handoff',
    'reply_burst_guard',
    'approval_unnotified',
    'answer_gap',
    'comprobante_sin_pedido',
    'visitor_request',
    'mensaje_no_recibido',
    'comment_sin_moderar',
    'ia_sin_respuesta',
    'ia_caida',
    'problema_detectado'
  ));
