-- Los registros de webhook_events_raw son una cola de RECUPERACIÓN, no un
-- historial de errores para siempre. Una vez que el canal volvió a sincronizar
-- y el incidente dejó de repetirse, mantenerlos con processed_at NULL hacía
-- que el panel siguiera anunciando cientos de pendientes ya resueltos.
--
-- Se conserva toda la evidencia (proveedor, cuerpo, error, fecha y reintentos):
-- sólo se marca como reconciliada. Las ventanas son deliberadamente holgadas
-- para no reconocer un incidente todavía activo.

BEGIN;

UPDATE public.webhook_events_raw
SET processed_at = now()
WHERE processed_at IS NULL
  AND (
    -- La conexión afectada ya fue reautorizada; los sondeos de Mercado Libre
    -- hacen el backfill. Los fallos nuevos seguirán visibles si reaparecen.
    (provider = 'mercadolibre:token'
      AND received_at < now() - interval '30 minutes')
    OR
    -- Caídas antiguas y no recurrentes de Supabase/TikTok/Shopify que ya
    -- pasaron varios ciclos de sus respectivos sincronizadores.
    (received_at < now() - interval '5 days'
      AND provider IN (
        'tiktok',
        'shopify:products/update',
        'channels:fb_comment',
        'channels:instagram',
        'channels:whatsapp'
      ))
  );

COMMIT;
