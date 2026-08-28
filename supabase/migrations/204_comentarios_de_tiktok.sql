-- 204 — TikTok entra a Comentarios.
--
-- TikTok es la primera red de comentarios SIN privado: su API de mensajes está
-- cerrada a terceros. Así que ahí la respuesta es siempre pública, y una regla
-- de TikTok no manda ningún DM — publica y ya.
--
-- Arranca APAGADO, al revés que Instagram: es una superficie nueva y lo que
-- publica lo lee cualquiera que pase por el video. Se enciende a propósito.
ALTER TABLE ig_proactive_settings
  ADD COLUMN IF NOT EXISTS comment_tiktok BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN ig_proactive_settings.comment_tiktok IS
  'La IA contesta los comentarios de TikTok. Siempre en público: TikTok no tiene privado.';

-- Y una regla puede escuchar TikTok. 'both' sigue siendo Instagram+Facebook:
-- son las dos que comparten el mecanismo del privado.
ALTER TABLE comment_to_dm_rules
  DROP CONSTRAINT IF EXISTS comment_to_dm_rules_channel_check;

ALTER TABLE comment_to_dm_rules
  ADD CONSTRAINT comment_to_dm_rules_channel_check
  CHECK (channel IN ('ig_comment', 'fb_comment', 'both', 'tiktok_comment'));
