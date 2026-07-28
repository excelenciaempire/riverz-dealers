-- ============================================================
-- 130 — La conversación recuerda que nació de una historia.
--
-- `messages.engagement_kind` (migración 120) ya distingue una respuesta a una
-- historia de un DM cualquiera, pero vive en el mensaje: la bandeja filtra por
-- CONVERSACIÓN y no podía saberlo sin recorrer los mensajes de cada hilo.
--
-- Se sube a la conversación igual que `is_ad`: se estampa la primera vez que
-- llega una interacción de historia y se queda. Así la pestaña Comentarios
-- puede mostrar "lo que reaccionó a tu contenido" —comentarios Y respuestas a
-- historias— sin un join por fila.
--
-- Valores: 'story_reply' | 'story_mention'. NULL = conversación normal, que es
-- la inmensa mayoría — de ahí el índice parcial.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS engagement_kind TEXT;

CREATE INDEX IF NOT EXISTS idx_conversations_engagement_kind
  ON conversations (workspace_id, engagement_kind, last_message_at DESC)
  WHERE engagement_kind IS NOT NULL;
