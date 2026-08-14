-- ============================================================
-- 143 — QUIÉN mandó cada mensaje saliente.
--
-- Hasta ahora la bandeja adivinaba: `sender_type='bot'` + plantilla se
-- mostraba como "Automatización" y todo lo demás como "Asistente IA". Con eso,
-- un DM que mandó Comentarios, un seguimiento, un flujo o una campaña se veían
-- todos iguales, y el comercio no podía explicarse un mensaje que él no
-- escribió (ni apagar la funcionalidad correcta).
--
--   origin      — código estable de la funcionalidad que lo envió.
--                 NULL = lo escribió una persona (o entró de la plataforma).
--   origin_name — nombre concreto de esa pieza (la automatización, el flujo,
--                 la campaña, el agente). Se guarda como FOTO: si después la
--                 renombran o la borran, el historial sigue diciendo la verdad
--                 de lo que pasó ese día.
--
-- Valores de `origin` (ver src/lib/inbox/message-origin.ts):
--   ai_agent | ai_followup | comment_ai | comment_rule | ig_outreach |
--   automation | flow | broadcast | voice_agent | order_update
--
-- Sin CHECK a propósito: una funcionalidad nueva no debe poder tumbar un
-- envío que ya salió por no haber corrido antes una migración.
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS origin TEXT,
  ADD COLUMN IF NOT EXISTS origin_name TEXT;

-- Parcial: la inmensa mayoría de las filas son entrantes o escritas por una
-- persona (origin NULL). El índice sirve para "qué mandó esta funcionalidad".
CREATE INDEX IF NOT EXISTS idx_messages_origin
  ON messages (origin, created_at DESC)
  WHERE origin IS NOT NULL;

COMMENT ON COLUMN messages.origin IS
  'Funcionalidad que envió el mensaje (ai_agent, automation, flow, broadcast, comment_ai, comment_rule, ig_outreach, ai_followup, voice_agent, order_update). NULL = humano.';
COMMENT ON COLUMN messages.origin_name IS
  'Nombre de la pieza concreta que lo envió (automatización, flujo, campaña, agente), fotografiado al momento del envío.';
