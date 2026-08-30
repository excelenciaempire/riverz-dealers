-- ============================================================
-- 227 - Cinco motivos de escalada que la base rechazaba en silencio
-- ============================================================
--
-- `conversations.needs_human_reason` tenia una CHECK con SIETE valores. El
-- codigo ya escribia DOCE. Los cinco que faltaban no fallaban ruidosamente:
-- el cliente de Supabase devuelve el error en el resultado en vez de tirarlo,
-- y en ninguno de los puntos de escritura se miraba. O sea que cinco caminos
-- de escalada estaban cortados y nadie lo sabia.
--
-- Verificado el 2026-08-30 sobre produccion: de los doce motivos, SOLO los que
-- la CHECK permitia tienen alguna fila. Los otros cinco: cero, nunca, desde
-- que existen.
--
-- Lo que se perdia:
--
--   comprobante_sin_pedido  Mando el comprobante y no encontramos su pedido.
--                           La IA le dice "lo estamos verificando y te aviso",
--                           y no habia nadie del otro lado. Visto ese mismo
--                           dia: tres comprobantes, cero escaladas.
--   mensaje_no_recibido     WhatsApp no nos entrega el archivo. Se colaba como
--                           `escalation_keyword`, que dice otra cosa.
--   comment_sin_moderar     Meta rechazo ocultar o responder: el comentario
--                           queda a la vista y sin respuesta.
--   ia_sin_respuesta        El modelo no devolvio nada usable.
--   ia_caida                Sin saldo o el turno se rompio.
--
-- Los tres ultimos son la tabla de desenlaces (`lib/ai/desenlace.ts`), que se
-- escribio para que registrar y escalar no pudieran separarse. Escalaba contra
-- una pared.
--
-- La lista sale de `NEEDS_HUMAN_REASONS` en src/types/index.ts y hay un test
-- que compara las dos: es la unica forma de que no se vuelvan a separar.
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
    'ia_caida'
  ));
