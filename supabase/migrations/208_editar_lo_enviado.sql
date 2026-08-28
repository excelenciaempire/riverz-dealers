-- ============================================================
-- 208: Editar un mensaje ya enviado
-- ============================================================
-- Sólo dos canales dejan reescribir de verdad lo que ya salió: el chat web
-- (es nuestro) y el comentario de Facebook (Graph acepta POST /{comment-id}
-- con `message`). En los demás no existe API de edición, así que la bandeja
-- ni siquiera ofrece el botón.
--
-- `edited_at` marca el mensaje como reescrito: la burbuja muestra "editado"
-- y el widget del visitante sabe qué mensajes viejos tiene que repintar
-- (su sondeo avanza por created_at y nunca volvería a mirarlos).
--
-- Aplicada A MANO por la Management API (no corre en el deploy de Render).
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

COMMENT ON COLUMN messages.edited_at IS
  'Cuándo se reescribió el mensaje ya enviado (chat web y comentario de Facebook).';

-- El widget pide "qué se editó desde tal momento" en cada sondeo.
CREATE INDEX IF NOT EXISTS idx_messages_edited
  ON messages(conversation_id, edited_at)
  WHERE edited_at IS NOT NULL;
