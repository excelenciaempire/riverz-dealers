-- ============================================================
-- 141 — `message-media` deja de ser público
-- ============================================================
--
-- El bucket guarda TODO lo que entra por WhatsApp, Instagram y Messenger:
-- fotos, comprobantes de pago, capturas de documentos y notas de voz de las
-- clientas. Estaba marcado como público, así que cualquiera con la URL leía
-- el archivo — sin sesión, sin ser del workspace y sin dejar rastro. Las
-- rutas llevan UUIDs, o sea que no se enumeraba a la fuerza, pero esas URLs
-- se guardaban en `messages.media_url` y de ahí viajaban a exportaciones,
-- logs y Sentry. Una URL filtrada era acceso permanente.
--
-- Segundo problema, más silencioso: ni este bucket ni `voice-recordings`
-- existían en ninguna migración. Se crearon a mano en el panel de Supabase,
-- así que su configuración no estaba versionada ni la revisaba nadie. Esta
-- migración los declara para que a partir de ahora sí.
--
-- Cómo se lee el contenido a partir de acá:
--   * La bandeja pide `/api/media/<ruta>`, que comprueba sesión y pertenencia
--     al workspace antes de firmar (5 min).
--   * Los envíos firman en el momento (24 h) porque Meta y Anthropic
--     descargan el archivo por su cuenta, sin nuestras cookies.
-- Ver `src/lib/channels/media-url.ts`.
--
-- Idempotente: los INSERT llevan ON CONFLICT DO UPDATE y el UPDATE de las
-- URLs sólo toca las filas que aún tienen el formato viejo.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Declarar los buckets (privados)
-- ------------------------------------------------------------
-- 25 MB es el mismo tope que aplica `MAX_ATTACHMENT_BYTES` en la ingesta:
-- sin él, Storage acepta un archivo que el código nunca va a poder servir.
-- Sin `allowed_mime_types`: por acá pasa lo que mande el cliente y no somos
-- nosotros quienes elegimos el formato. Nada de esto se ejecuta — se sirve
-- por URL firmada y con Content-Type declarado.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('message-media', 'message-media', FALSE, 26214400)
ON CONFLICT (id) DO UPDATE
  SET public = FALSE,
      file_size_limit = EXCLUDED.file_size_limit;

-- Grabaciones de llamadas. Ya se servían firmadas desde el código
-- (`/api/voice/calls/[id]`), pero el bucket tampoco estaba declarado.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('voice-recordings', 'voice-recordings', FALSE, 104857600)
ON CONFLICT (id) DO UPDATE
  SET public = FALSE,
      file_size_limit = EXCLUDED.file_size_limit;

-- ------------------------------------------------------------
-- 2. Sin políticas para los roles normales
-- ------------------------------------------------------------
-- `storage.objects` tiene RLS activa, así que sin política el acceso es
-- denegado para `anon` y `authenticated`. El service role (el único que toca
-- estos buckets: sube en la ingesta y firma en la lectura) la salta.
--
-- El DROP es por si el panel dejó alguna política suelta al crear el bucket
-- como público. `IF EXISTS` lo hace repetible.
DROP POLICY IF EXISTS "Message media is publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Public read message-media" ON storage.objects;
DROP POLICY IF EXISTS "Voice recordings are publicly readable" ON storage.objects;

-- ------------------------------------------------------------
-- 3. Reescribir las URLs ya guardadas
-- ------------------------------------------------------------
-- Las filas viejas apuntan a
--   https://<ref>.supabase.co/storage/v1/object/public/message-media/<ruta>
-- que a partir de este momento devuelve 400. Se reescriben a `/api/media/<ruta>`,
-- que es la forma que produce el código nuevo. Relativa a propósito: no ata
-- los datos al dominio que sirva la app hoy.
--
-- `resolveMediaFetchUrl` reconoce las dos formas, así que una fila que se
-- escape de este UPDATE se sigue firmando bien en los envíos; lo que se
-- rompería es sólo la miniatura en la bandeja.
UPDATE messages
SET media_url = '/api/media/' ||
  split_part(media_url, '/storage/v1/object/public/message-media/', 2)
WHERE media_url LIKE '%/storage/v1/object/public/message-media/%';

-- ------------------------------------------------------------
-- 4. Comprobación
-- ------------------------------------------------------------
-- Falla ruidosamente si algo quedó a medias, en vez de dejar el bucket
-- abierto creyendo que se cerró.
DO $$
DECLARE
  still_public BOOLEAN;
  stale_urls INT;
BEGIN
  SELECT public INTO still_public FROM storage.buckets WHERE id = 'message-media';
  IF still_public IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'message-media sigue siendo público';
  END IF;

  SELECT count(*) INTO stale_urls FROM messages
  WHERE media_url LIKE '%/storage/v1/object/public/message-media/%';
  IF stale_urls > 0 THEN
    RAISE EXCEPTION 'quedaron % URLs con el formato público viejo', stale_urls;
  END IF;
END $$;
