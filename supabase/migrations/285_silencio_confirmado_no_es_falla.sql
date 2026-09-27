-- ============================================================
-- 285 - Un silencio que el sondeo ya confirmó no es una falla
-- ============================================================
--
-- `channel_silent` mira el síntoma: el canal lleva callado más de lo normal.
-- Pero los canales que se sondean (Messenger, Instagram, comentarios, TikTok,
-- Gmail, Outlook) tienen una prueba mejor: cada pocos minutos le preguntan al
-- proveedor si hay algo nuevo, y `last_synced_at` sólo avanza cuando esa
-- consulta salió bien. Si salió bien después del último mensaje, nada se está
-- perdiendo: el canal está quieto de verdad.
--
-- El 2026-09-26 el Messenger de Rasmiaw avisó "Canal sin actividad" con el
-- webhook entregando y el sondeo de las 02:50 completo y sin novedades.
--
-- WhatsApp y el chat web no sondean ni escriben `last_synced_at`: siguen igual.
--
-- Mismo método que la 257: parche sobre la definición viva.
-- ============================================================

DO $migration$
DECLARE
  original text := pg_get_functiondef('public.admin_workspace_issues(uuid)'::regprocedure);
  revised text;
  ancla text := $a$                AND cc.status = 'connected'
           )
       -- Tres veces$a$;
BEGIN
  IF position('health_silence_confirmed_by_poll' IN original) > 0 THEN RETURN; END IF;
  revised := replace(original, ancla, $r$                AND cc.status = 'connected'
           )
       -- health_silence_confirmed_by_poll: un sondeo sano posterior al
       -- ultimo mensaje prueba que no se esta perdiendo nada.
       AND NOT EXISTS (
             SELECT 1 FROM channel_connections cc
              WHERE cc.workspace_id = r.workspace_id
                AND cc.channel = r.channel
                AND cc.status = 'connected'
                AND cc.last_error IS NULL
                AND cc.last_synced_at > u.last_in
                AND cc.last_synced_at > now() - interval '1 hour'
           )
       -- Tres veces$r$);
  IF revised = original THEN RAISE EXCEPTION 'health silence connection check not found'; END IF;
  EXECUTE revised;
END;
$migration$;
