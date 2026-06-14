-- ============================================================
-- 036: Anti-duplicado de messages por (conversation_id, message_id)
-- ============================================================
--
-- El webhook de Meta a veces re-entrega el mismo mensaje (mismo
-- message_id externo) cuando hay reintentos o cuando dos workers
-- procesan el mismo evento. Resultado: filas duplicadas en el hilo.
--
-- Solución:
--   1. Backfill: conservar la fila más vieja (created_at ASC, id ASC)
--      por (conversation_id, message_id) cuando message_id no es nulo.
--   2. Índice único parcial: bloquea futuros INSERTs duplicados; el
--      código cae al SELECT cuando recibe el segundo evento.

-- ---------- 1) Backfill ----------
WITH ranking AS (
  SELECT
    id,
    conversation_id,
    message_id,
    ROW_NUMBER() OVER (
      PARTITION BY conversation_id, message_id
      ORDER BY created_at ASC, id ASC
    ) AS rk
  FROM messages
  WHERE message_id IS NOT NULL
)
DELETE FROM messages m
USING ranking r
WHERE m.id = r.id AND r.rk > 1;

-- ---------- 2) Índice único parcial ----------
CREATE UNIQUE INDEX IF NOT EXISTS uniq_msg_per_conv
  ON messages (conversation_id, message_id)
  WHERE message_id IS NOT NULL;

COMMENT ON INDEX uniq_msg_per_conv IS
  'Un mensaje por (conversation_id, message_id externo). Migration 036.';
