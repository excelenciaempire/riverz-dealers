-- ============================================================
-- 035: Anti-duplicado de conversations + cleanup
-- ============================================================
--
-- El webhook de Instagram (y WhatsApp en menor medida) ocasionalmente
-- dispara el mismo evento dos veces casi simultáneo. findOrCreate
-- en código no usa una transacción seria, así que dos llamadas
-- concurrentes pueden hacer ambas un SELECT que falla (no existe la
-- conv) y luego ambas un INSERT. Resultado: dos filas idénticas en
-- el inbox (lo que el merchant ve como una conversación duplicada).
--
-- Solución:
--   1. Backfill: para cada cluster (workspace, contact, channel,
--      thread_external_id) con más de una fila, conservar la MÁS
--      VIEJA (created_at ASC), re-apuntar los messages al ganador y
--      borrar las perdedoras.
--   2. Índice único: una conv por (workspace, contact, channel,
--      COALESCE(thread_external_id, '')). El webhook a partir de
--      ahora rechazará el INSERT duplicado y caerá al SELECT.

-- ---------- 1) Backfill ----------
-- ranking_dups: filas con su rank dentro del cluster (1 = más vieja).
-- Las filas con rank > 1 son las perdedoras.
WITH ranking AS (
  SELECT
    id,
    workspace_id,
    contact_id,
    channel,
    COALESCE(thread_external_id, '') AS thread_key,
    ROW_NUMBER() OVER (
      PARTITION BY workspace_id, contact_id, channel, COALESCE(thread_external_id, '')
      ORDER BY created_at ASC, id ASC
    ) AS rk
  FROM conversations
),
winners AS (
  SELECT id, workspace_id, contact_id, channel, thread_key
  FROM ranking
  WHERE rk = 1
),
losers AS (
  SELECT r.id AS loser_id, w.id AS winner_id
  FROM ranking r
  JOIN winners w
    ON w.workspace_id = r.workspace_id
   AND w.contact_id = r.contact_id
   AND w.channel = r.channel
   AND w.thread_key = r.thread_key
  WHERE r.rk > 1
)
-- Re-apuntar todos los messages de los duplicados al ganador.
UPDATE messages m
SET conversation_id = losers.winner_id
FROM losers
WHERE m.conversation_id = losers.loser_id;

-- Mismo cleanup para flow_runs (si hay).
WITH ranking AS (
  SELECT
    id,
    workspace_id,
    contact_id,
    channel,
    COALESCE(thread_external_id, '') AS thread_key,
    ROW_NUMBER() OVER (
      PARTITION BY workspace_id, contact_id, channel, COALESCE(thread_external_id, '')
      ORDER BY created_at ASC, id ASC
    ) AS rk
  FROM conversations
),
winners AS (
  SELECT id, workspace_id, contact_id, channel, thread_key
  FROM ranking
  WHERE rk = 1
),
losers AS (
  SELECT r.id AS loser_id, w.id AS winner_id
  FROM ranking r
  JOIN winners w
    ON w.workspace_id = r.workspace_id
   AND w.contact_id = r.contact_id
   AND w.channel = r.channel
   AND w.thread_key = r.thread_key
  WHERE r.rk > 1
)
UPDATE flow_runs fr
SET conversation_id = losers.winner_id
FROM losers
WHERE fr.conversation_id = losers.loser_id;

-- Finalmente, borrar las filas de conversations perdedoras.
WITH ranking AS (
  SELECT
    id,
    workspace_id,
    contact_id,
    channel,
    COALESCE(thread_external_id, '') AS thread_key,
    ROW_NUMBER() OVER (
      PARTITION BY workspace_id, contact_id, channel, COALESCE(thread_external_id, '')
      ORDER BY created_at ASC, id ASC
    ) AS rk
  FROM conversations
)
DELETE FROM conversations c
USING ranking r
WHERE c.id = r.id AND r.rk > 1;

-- ---------- 2) Índice único anti-duplicado ----------
CREATE UNIQUE INDEX IF NOT EXISTS uniq_conv_per_thread
  ON conversations (
    workspace_id,
    contact_id,
    channel,
    COALESCE(thread_external_id, '')
  );

COMMENT ON INDEX uniq_conv_per_thread IS
  'Una conversación por (workspace, contact, channel, thread). Migration 035.';
