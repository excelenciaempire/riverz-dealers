-- ============================================================
-- 193_tiktok_videos.sql
--
-- Qué dice el video sobre el que están comentando.
--
-- Un comentario de TikTok no responde a una conversación: responde a un
-- video. Sin el video, el agente contesta a ciegas — medido hoy en la cuenta
-- viva, ante "eso también es cuando se expone mucho al sol" el borrador
-- salía diciendo "me falta contexto de la conversación anterior", que es
-- exactamente lo que un cliente no tiene que leer nunca.
--
-- Acá vive lo que el video ES: su texto (caption) y la transcripción de lo
-- que se dice en pantalla. El guion del anuncio suele traer el precio, la
-- promoción, los ingredientes y la promesa — o sea, casi todas las respuestas
-- a los comentarios que llegan debajo.
--
-- La transcripción se hace una vez por video y se guarda para siempre: un
-- video con 400 comentarios se transcribe una vez, no 400.
-- ============================================================

CREATE TABLE IF NOT EXISTS tiktok_videos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  connection_id UUID REFERENCES channel_connections(id) ON DELETE SET NULL,
  -- item_id de TikTok. Con el workspace es la identidad del video.
  video_id TEXT NOT NULL,
  caption TEXT,
  share_url TEXT,
  posted_at TIMESTAMPTZ,

  transcript TEXT,
  -- pending  : todavía no se intentó (o toca reintentar)
  -- ok       : hay transcripción
  -- sin_audio: el video no tiene voz — no hay nada que transcribir
  -- error    : falló; `transcript_error` dice por qué y se reintenta
  transcript_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (transcript_status = ANY (ARRAY['pending', 'ok', 'sin_audio', 'error'])),
  transcript_error TEXT,
  -- Cuántas veces se intentó. Un video que falla siempre deja de intentarse
  -- para no quemar la cuota en el mismo archivo roto cada seis horas.
  transcript_attempts INTEGER NOT NULL DEFAULT 0,
  transcribed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE tiktok_videos IS
  'Los videos de la cuenta de TikTok conectada, con la transcripción de su audio. Es el contexto que el agente necesita para contestar un comentario: el comentario responde al video, no a una conversación previa.';

-- ON CONFLICT necesita un índice único NO parcial.
CREATE UNIQUE INDEX IF NOT EXISTS tiktok_videos_key
  ON tiktok_videos(workspace_id, video_id);

-- La cola de transcripción: los pendientes, del más nuevo al más viejo.
CREATE INDEX IF NOT EXISTS tiktok_videos_pendientes_idx
  ON tiktok_videos(transcript_status, posted_at DESC NULLS LAST)
  WHERE transcript_status IN ('pending', 'error');

ALTER TABLE tiktok_videos ENABLE ROW LEVEL SECURITY;

-- Sólo lectura para el equipo del comercio: acá escriben el cron y el
-- webhook, siempre con la clave de servicio.
DROP POLICY IF EXISTS "Members read workspace tiktok videos" ON tiktok_videos;
CREATE POLICY "Members read workspace tiktok videos" ON tiktok_videos
  FOR SELECT USING (is_workspace_member(workspace_id));
