-- ============================================================
-- 085 — Soft-delete de conversaciones (borrar de la bandeja sin perder datos)
-- ============================================================
--
-- "Borrar" una conversación desde la bandeja ya NO hace DELETE físico (que
-- cascadeaba sus messages vía FK). Ahora marca `deleted_at`: la fila
-- desaparece de la bandeja pero los messages se conservan. Con eso:
--
--   1) Las métricas por fecha (mensajes recibidos/enviados, mix por canal,
--      serie temporal, tiempos de respuesta) se calculan sobre `messages`,
--      así que sobreviven al borrado — antes el delete físico las vaciaba.
--
--   2) El polling de email (Outlook/Gmail) deja de "revivir" un correo
--      borrado en una conversación nueva: el `message_id` sigue existiendo,
--      y el ingest deduplica por id externo a nivel workspace antes de crear
--      nada (el índice único `uniq_msg_per_conv` es por conversación, así que
--      no cubría este caso cuando la conversación cambia).
--
-- Migración aditiva y segura: columna nullable + dos índices parciales. No
-- borra ni reescribe ninguna fila.

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Lookups de la bandeja: solo conversaciones vivas (deleted_at IS NULL),
-- ordenadas por actividad reciente. Reemplaza en la práctica el orden por
-- last_message_at de la lista.
CREATE INDEX IF NOT EXISTS idx_conversations_active
  ON conversations (workspace_id, last_message_at DESC)
  WHERE deleted_at IS NULL;

-- Dedup global por id externo de mensaje: el ingest consulta
-- messages.message_id directo (sin la conversación, que pudo borrarse) para
-- no re-ingerir un correo ya visto. Sin este índice sería un seq scan porque
-- uniq_msg_per_conv lleva conversation_id como primera columna.
CREATE INDEX IF NOT EXISTS idx_messages_message_id
  ON messages (message_id)
  WHERE message_id IS NOT NULL;

-- El índice anti-duplicado de conversaciones (035) era TOTAL, así que una
-- conversación soft-deleted seguía ocupando su clave (workspace, contact,
-- channel, thread) y bloqueaba la creación de una NUEVA cuando el contacto
-- volvía a escribir (23505 → mensaje perdido). Lo volvemos PARCIAL: la
-- unicidad solo aplica a conversaciones vivas. Seguro de recrear ahora porque
-- aún no hay ninguna borrada (todas con deleted_at IS NULL).
DROP INDEX IF EXISTS uniq_conv_per_thread;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_conv_per_thread
  ON conversations (
    workspace_id,
    contact_id,
    channel,
    COALESCE(thread_external_id, '')
  )
  WHERE deleted_at IS NULL;
