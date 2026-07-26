-- ============================================================
-- 120 — De qué INTERACCIÓN nació cada mensaje + interruptor de outreach.
--
-- 1. messages.engagement_kind
--
-- Una respuesta a una historia, una mención en una historia y una reacción a
-- un DM entran todas por el webhook `messages` de Meta y quedaban indistinguibles
-- de un DM normal. Eso costaba dos cosas:
--   - el comercio no podía decir "escríbele a los que respondieron mi historia
--     de ayer", que es la audiencia más caliente y la única de ese tipo que
--     Meta sí permite contactar (la respuesta abre la ventana de 24h);
--   - el agente trataba "me encantó tu historia" igual que una consulta fría.
--
-- Valores: 'story_reply' | 'story_mention' | 'reaction'. NULL = mensaje normal,
-- que es la inmensa mayoría — de ahí el índice parcial.
--
-- 2. ig_proactive_settings.outreach_enabled
--
-- Cada funcionalidad se prende y se apaga por su cuenta, como los agentes:
-- `auto_reply_comments` gobierna responder comentarios y este gobierna salir a
-- buscar. Encendido por defecto; el freno de emergencia (`paused`) sigue
-- mandando sobre los dos.
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS engagement_kind TEXT;

CREATE INDEX IF NOT EXISTS idx_messages_engagement_kind
  ON messages (engagement_kind, created_at DESC)
  WHERE engagement_kind IS NOT NULL;

ALTER TABLE ig_proactive_settings
  ADD COLUMN IF NOT EXISTS outreach_enabled BOOLEAN NOT NULL DEFAULT TRUE;
