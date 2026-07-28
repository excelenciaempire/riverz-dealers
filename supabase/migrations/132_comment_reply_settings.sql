-- ============================================================
-- 132 — Comentarios configurable: a quién responde la IA y cuánto insiste.
--
-- Hasta ahora las dos decisiones estaban clavadas en el código:
--
--   - solo contestaba a quien mostraba intención de compra. El comerciante que
--     prefiere contestar a TODO el que pregunta no tenía forma de decirlo;
--   - insistía como mucho 3 veces en un mismo hilo, un número que nadie eligió.
--
-- Los defaults reproducen exactamente el comportamiento anterior, así que
-- ningún workspace cambia de conducta al aplicar esto.
--
-- No se añade aquí "responder en público": necesita los permisos de Meta
-- (`pages_manage_engagement`, `instagram_manage_comments`) que fueron
-- RECHAZADOS en App Review. Sería una casilla que falla en silencio.
--
-- Idempotente. Se aplica A MANO por la Management API.
-- ============================================================

ALTER TABLE ig_proactive_settings
  -- 'intent' = solo a quien muestra intención de compra (lo de siempre).
  -- 'all'    = a todo el que pregunte algo; el spam se sigue filtrando.
  ADD COLUMN IF NOT EXISTS comment_audience TEXT NOT NULL DEFAULT 'intent',
  -- Cuántas veces puede contestar la IA dentro del MISMO hilo antes de
  -- callarse y dejarlo para una persona. 0 = sin tope.
  ADD COLUMN IF NOT EXISTS comment_max_thread_replies INTEGER NOT NULL DEFAULT 3;

DO $$
BEGIN
  ALTER TABLE ig_proactive_settings
    ADD CONSTRAINT ig_proactive_settings_comment_audience_check
    CHECK (comment_audience IN ('intent', 'all'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
