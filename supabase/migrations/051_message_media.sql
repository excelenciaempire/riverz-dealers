-- ============================================================
-- 051: input multimodal — metadatos de media en `messages`
-- ============================================================
--
-- Hasta acá guardábamos sólo `media_url` (legacy WhatsApp) y un
-- `attachments` JSONB free-form. La IA recibía "[Imagen]" como texto
-- y se perdía el contenido real.
--
-- Esta migration agrega columnas estructuradas para que:
--   * el inbox pueda renderizar el preview correcto sin parsear JSON,
--   * el runner sepa si tiene que mandar la imagen a Claude o si ya
--     tiene una transcripción de la voice note,
--   * podamos transcribir audios una sola vez y cachear el resultado.
--
-- Convención de `media_type`:
--   * image   — fotos JPEG/PNG/WEBP/HEIC
--   * voice   — voice notes (audio/ogg, audio/amr — WhatsApp)
--   * audio   — audio adjunto que NO es voice note
--   * video   — video/mp4 etc.
--   * document— PDF + otros archivos
--   * sticker — sticker WhatsApp/IG
--
-- `media_mime` es el Content-Type real del archivo bajado.
-- `media_size` está en bytes.
-- `media_transcription` cachea la transcripción de audio/voice (Whisper)
-- para no re-transcribir en cada turno del agente.

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS media_type TEXT
    CHECK (media_type IN ('image','voice','audio','video','document','sticker')),
  ADD COLUMN IF NOT EXISTS media_mime TEXT,
  ADD COLUMN IF NOT EXISTS media_size INTEGER,
  ADD COLUMN IF NOT EXISTS media_transcription TEXT;

COMMENT ON COLUMN messages.media_type IS
  'Categoría del adjunto (image/voice/audio/video/document/sticker). Migration 051.';
COMMENT ON COLUMN messages.media_mime IS
  'Content-Type real del archivo bajado. Migration 051.';
COMMENT ON COLUMN messages.media_size IS
  'Tamaño en bytes del archivo bajado. Migration 051.';
COMMENT ON COLUMN messages.media_transcription IS
  'Transcripción cacheada (Whisper) para audios/voice notes. Migration 051.';
