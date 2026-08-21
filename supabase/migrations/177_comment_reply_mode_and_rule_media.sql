-- ============================================================
-- 177: Cómo contesta la IA un comentario + recurso en las reglas
-- ============================================================
--
-- 1) `comment_reply_mode` — UNA sola decisión para "qué sale cuando la IA
--    contesta un comentario", en vez de dos interruptores que se pisaban
--    (`comment_public_reply` + "siempre manda DM" clavado en el código):
--
--      dm           — solo por privado (la conducta histórica).
--      public_dm    — en el comentario y por privado, siempre.
--      public_smart — en el comentario siempre; por privado SOLO si la IA ve
--                     una oportunidad o el asunto es privado (pedido, reclamo,
--                     precio/código). Esto es lo nuevo.
--      public       — solo en el comentario, nunca DM.
--
--    Se rellena desde el interruptor viejo para que ningún comercio cambie de
--    conducta al aplicar la migración. `comment_public_reply` se conserva (no
--    se lee más) por si hay que volver atrás.
--
-- 2) Las reglas comentario→DM pueden adjuntar UN recurso (imagen, video, audio
--    o archivo) además del texto: el catálogo en PDF, el cupón como imagen.
--    Si Meta rechaza el adjunto en una respuesta privada, el motor manda el
--    enlace como texto — el recurso llega igual.

ALTER TABLE ig_proactive_settings
  ADD COLUMN IF NOT EXISTS comment_reply_mode TEXT NOT NULL DEFAULT 'dm';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ig_proactive_settings_reply_mode_chk'
  ) THEN
    ALTER TABLE ig_proactive_settings
      ADD CONSTRAINT ig_proactive_settings_reply_mode_chk
      CHECK (comment_reply_mode IN ('dm', 'public_dm', 'public_smart', 'public'));
  END IF;
END $$;

-- Conducta idéntica a la de ayer: quien tenía la respuesta pública encendida
-- sigue publicando + mandando DM; el resto, solo DM.
UPDATE ig_proactive_settings
   SET comment_reply_mode = CASE WHEN comment_public_reply THEN 'public_dm' ELSE 'dm' END
 WHERE comment_reply_mode = 'dm';

ALTER TABLE comment_to_dm_rules
  ADD COLUMN IF NOT EXISTS dm_attachment_url TEXT,
  ADD COLUMN IF NOT EXISTS dm_attachment_type TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'comment_to_dm_rules_attachment_type_chk'
  ) THEN
    ALTER TABLE comment_to_dm_rules
      ADD CONSTRAINT comment_to_dm_rules_attachment_type_chk
      CHECK (
        dm_attachment_type IS NULL
        OR dm_attachment_type IN ('image', 'video', 'audio', 'file')
      );
  END IF;
END $$;
