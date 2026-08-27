-- ============================================================
-- 202: preguntar si sirvió, en todos los canales
-- ============================================================
-- Las columnas de satisfacción existen desde la migración 181 y las escribe UN
-- solo lugar: el widget del chat web. En WhatsApp, Instagram, Messenger y el
-- correo —donde pasa la mayoría de las conversaciones— nunca se le preguntó
-- nada a nadie, así que el número que el panel muestra como "satisfacción" mide
-- un canal y se lee como si midiera la atención entera.
--
-- Dos columnas y nada más:
--
--   `workspaces.csat_enabled` — apagado por defecto, a propósito. Es un mensaje
--   extra a cada cliente al cerrar el caso; en WhatsApp además se paga. Que lo
--   encienda quien quiera medirlo.
--
--   `conversations.csat_asked_at` — cuándo se preguntó. Sirve para dos cosas:
--   no preguntar dos veces, y saber que el "1" que llega después es una
--   calificación y no una consulta nueva.
--
-- Idempotente. Se aplica a mano por la Management API.

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS csat_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN workspaces.csat_enabled IS
  'Preguntar "¿te sirvió?" al cerrar una conversación, fuera del chat web. Apagado por defecto: es un mensaje más a cada cliente, y en WhatsApp se paga.';

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS csat_asked_at TIMESTAMPTZ;

COMMENT ON COLUMN conversations.csat_asked_at IS
  'Cuándo se pidió la opinión. Evita preguntar dos veces y permite leer la respuesta corta que llega después como calificación.';

-- Quien contesta la encuesta lo hace en un hilo NUEVO: cerrar la conversación
-- impide reusarla, así que la respuesta se busca por contacto entre las que
-- preguntaron hace poco y todavía no tienen nota.
CREATE INDEX IF NOT EXISTS idx_conversations_csat_pendiente
  ON conversations (contact_id, csat_asked_at DESC)
  WHERE csat_asked_at IS NOT NULL AND csat IS NULL;

-- El interruptor lo lee el servidor con llave de servicio, pero también la
-- pantalla de Ajustes con la sesión del admin.
GRANT SELECT (csat_enabled) ON workspaces TO authenticated;
