-- 205 — De qué habla esta persona: la publicación, entendida.
--
-- En TikTok el agente ya no contesta a ciegas: se transcribe el audio del
-- video y con el guion arriba, "eso también es cuando se expone mucho al sol"
-- se entiende. En Instagram y Facebook seguía leyendo sólo el TEXTO del post
-- —y en Instagram el texto suele ser tres palabras y un emoji: lo que la
-- persona está comentando es la FOTO—. Y en Mercado Libre, donde cada
-- pregunta cuelga de una publicación concreta, no leía nada.
--
-- Esta tabla es la memoria de eso: una fila por publicación (no por
-- comentario), con lo que se sabe de ella y lo que se entendió de su imagen o
-- su video. Un post con 400 comentarios se entiende UNA vez.
--
-- TikTok conserva `tiktok_videos`: ya funciona, tiene su propio cron y su
-- propia forma de conseguir el audio. Esto es para el resto.
CREATE TABLE IF NOT EXISTS publicacion_contexto (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- El canal donde vive: ig_comment, fb_comment, mercadolibre, ml_review.
  channel TEXT NOT NULL,
  -- Id de la publicación en su plataforma (post de Meta, item de ML).
  external_id TEXT NOT NULL,
  titulo TEXT,
  cuerpo TEXT,
  -- 'imagen' | 'video' | NULL cuando la publicación no tiene medio.
  medio_tipo TEXT,
  medio_url TEXT,
  -- Qué muestra la foto, o qué se dice en el video. Lo que antes faltaba.
  medio_entendido TEXT,
  -- pendiente | listo | sin_medio | error
  estado TEXT NOT NULL DEFAULT 'pendiente',
  intentos INT NOT NULL DEFAULT 0,
  intentado_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, channel, external_id)
);

-- La cola del cron: lo pendiente, lo más nuevo primero.
CREATE INDEX IF NOT EXISTS publicacion_contexto_pendientes_idx
  ON publicacion_contexto (estado, intentado_at NULLS FIRST)
  WHERE estado IN ('pendiente', 'error');

ALTER TABLE publicacion_contexto ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS publicacion_contexto_select ON publicacion_contexto;
CREATE POLICY publicacion_contexto_select ON publicacion_contexto
  FOR SELECT USING (is_workspace_member(workspace_id));
