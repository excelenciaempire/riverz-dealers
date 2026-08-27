-- 203 — En qué redes trabaja Comentarios.
--
-- Antes Instagram estaba clavado y Facebook era un "también": no había forma de
-- decir "solo Facebook", y la pregunta real del comercio es una sola —¿en qué
-- redes?— con tres respuestas. Se agrega la columna que faltaba para poder
-- contestarla entera.
--
-- `comment_instagram` arranca en true: es lo que hacía el sistema hasta ahora,
-- así que nadie se queda mudo por aplicar esto.
ALTER TABLE ig_proactive_settings
  ADD COLUMN IF NOT EXISTS comment_instagram BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN ig_proactive_settings.comment_instagram IS
  'La IA contesta los comentarios de Instagram. Con comment_facebook forman la pregunta "en qué redes".';

-- Y lo mismo para una regla: hasta ahora escuchaba UNA red, así que la misma
-- regla escrita para las dos había que escribirla dos veces (y editarla dos
-- veces cada vez que cambiaba el texto). 'both' escucha las dos.
ALTER TABLE comment_to_dm_rules
  DROP CONSTRAINT IF EXISTS comment_to_dm_rules_channel_check;

ALTER TABLE comment_to_dm_rules
  ADD CONSTRAINT comment_to_dm_rules_channel_check
  CHECK (channel IN ('ig_comment', 'fb_comment', 'both'));
