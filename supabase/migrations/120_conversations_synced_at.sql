-- 120 — Marca de la última sincronización del historial con la plataforma.
--
-- Al abrir un chat de Messenger/Instagram, la bandeja le pide a Meta el
-- historial del hilo y rellena lo que falte (mensajes que no llegaron por
-- webhook y respuestas mandadas desde la app de Meta). Sin una marca, cada
-- apertura dispararía la misma tanda de llamadas a Graph: esta columna
-- sostiene el "no volver a preguntar por 10 minutos".
--
-- NULL = nunca sincronizada (se sincroniza en la primera apertura).

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;

COMMENT ON COLUMN conversations.synced_at IS
  'Último relleno de historial desde la plataforma (Meta Graph). Throttle de /api/conversations/:id/sync.';
