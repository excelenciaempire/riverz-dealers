-- Un cliente que decide pagar por un medio cuyo enlace prepara el equipo no
-- tiene un problema ni pidió hablar con alguien, pero sí necesita el traspaso.

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
      'problema_detectado',
      'pago_asistido'
    )
  );
