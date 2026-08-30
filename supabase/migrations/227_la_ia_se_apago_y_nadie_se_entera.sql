-- 227 — La IA se apago sola y nadie se entera
--
-- `ai_replies.skip_reason` ya distingue los cinco motivos en los que el turno
-- no salio por culpa NUESTRA o del proveedor: sin saldo en Anthropic, el
-- proveedor frenando, el proveedor fallando, un error del modelo, o el turno
-- roto antes de contestar. En los cinco el cliente recibe "en un momento te
-- responde una persona" y la IA deja de contestar.
--
-- Eso no llegaba a NINGUN lado: `health/issues` nunca leyo `ai_replies`, asi
-- que no habia aviso, ni correo diario, ni fila en /admin. El comercio se
-- enteraba mirando las etiquetas de la bandeja una por una — o no se enteraba.
--
-- Se agrega `ai_down` a la misma funcion que ya calcula todo lo demas, para
-- que las dos pantallas no se puedan contradecir. Ventana de una hora, piso de
-- tres: un fallo suelto es ruido de red y se recupera solo.
--
-- La audiencia depende del motivo, que es lo que decide quien puede
-- arreglarlo: sin saldo lo resuelve el comercio recargando; el resto es del
-- proveedor y lo miramos nosotros.

-- ============================================================
-- 224 - Un comentario borrado no es un envio fallido
-- ============================================================
--
-- El comercio borraba un comentario propio a proposito y el panel le gritaba
-- en rojo que un mensaje no se habia podido entregar. Pasa porque borrar deja
-- la fila con status='failed' y el texto '[deleted]' —la convencion que usan
-- la bandeja y la conciliacion para pintarlo tachado— y `sends_failing`
-- contaba filas fallidas sin mirar el texto.
--
-- Visto en produccion el 2026-08-30: era el UNICO aviso critico de la cuenta,
-- y era falso. Un aviso falso no cuesta solo su linea: gasta la credibilidad
-- de los otros siete.
--
-- El aviso de voz (`voice_send_failed`) no lleva el filtro: pide
-- origin='voice_agent' y por ahi no pasa ningun comentario.
--
-- Aplicada A MANO por la Management API (no corre en el deploy de Render).
-- ============================================================

CREATE OR REPLACE FUNCTION admin_workspace_issues(p_workspace_id UUID DEFAULT NULL)
RETURNS TABLE (
  workspace_id UUID,
  kind         TEXT,
  severity     TEXT,
  count        BIGINT,
  detail       TEXT,
  -- La cosa a la que apunta el aviso: automatización, conversación, plantilla,
  -- campaña, canal.
  ref_id       TEXT,
  -- La fila exacta dentro de esa cosa: la corrida que falló. Cuando el aviso
  -- apunta a una conversación no hace falta: el instante es `last_at`.
  ref_child    TEXT,
  -- Cuándo pasó por última vez. Es lo que decide si un aviso ocultado vuelve.
  last_at      TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH scope AS (
    SELECT w.id
      FROM workspaces w
     WHERE w.deleted_at IS NULL
       AND (p_workspace_id IS NULL OR w.id = p_workspace_id)
  ),

  -- 1) Corridas a medio camino. "parcial" es normal MIENTRAS la automatización
  -- espera; deja de serlo cuando pasaron horas y no hay ninguna reanudación
  -- encolada: ahí el mensaje no va a salir nunca solo.
  stuck AS (
    SELECT l.workspace_id,
           count(*) AS n,
           (array_agg(l.automation_id ORDER BY l.created_at DESC))[1] AS automation_id,
           (array_agg(l.id ORDER BY l.created_at DESC))[1] AS log_id,
           max(l.created_at) AS last_at
      FROM automation_logs l
      JOIN scope s ON s.id = l.workspace_id
     WHERE l.status = 'partial'
       AND l.created_at < now() - interval '2 hours'
       AND NOT EXISTS (
         SELECT 1 FROM automation_pending_executions p
          WHERE p.log_id = l.id AND p.status IN ('pending', 'running')
       )
     GROUP BY 1
  ),

  -- 2) Corridas que reventaron. El mensaje del error va crudo a propósito:
  -- "template not found: carrito_v3" dice exactamente qué arreglar.
  failed AS (
    SELECT l.workspace_id,
           count(*) AS n,
           (array_agg(l.automation_id ORDER BY l.created_at DESC))[1] AS automation_id,
           (array_agg(l.id ORDER BY l.created_at DESC))[1] AS log_id,
           (array_agg(l.error_message ORDER BY l.created_at DESC)
              FILTER (WHERE l.error_message IS NOT NULL))[1] AS msg,
           max(l.created_at) AS last_at
      FROM automation_logs l
      JOIN scope s ON s.id = l.workspace_id
     WHERE l.status = 'failed'
       AND l.created_at >= now() - interval '24 hours'
     GROUP BY 1
  ),

  -- 3) Mensajes que el canal rechazó, con el motivo más repetido. Menos de tres
  -- es ruido normal (un número mal escrito, un bloqueo puntual).
  send_fail AS (
    SELECT c.workspace_id,
           count(*) AS n,
           (array_agg(c.id ORDER BY m.created_at DESC))[1] AS conversation_id,
           max(m.created_at) AS last_at
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      JOIN scope s ON s.id = c.workspace_id
     WHERE m.status = 'failed'
       -- Un comentario BORRADO no es un envio fallido: borrarlo deja la fila
       -- con status='failed' y el texto '[deleted]' —la convencion que usan la
       -- bandeja y la conciliacion para pintarlo tachado—, y esto la contaba
       -- como "no se pudo entregar". El comercio borraba tres comentarios a
       -- proposito y el panel le gritaba en rojo. Visto el 2026-08-30, y era el
       -- unico aviso critico de la cuenta.
       AND coalesce(btrim(m.content_text), '') <> '[deleted]'
       AND m.created_at >= now() - interval '6 hours'
     GROUP BY 1
    HAVING count(*) >= 3
  ),
  send_reason AS (
    SELECT workspace_id, reason, n,
           row_number() OVER (PARTITION BY workspace_id ORDER BY n DESC) AS rk
      FROM (
        SELECT c.workspace_id,
               COALESCE(NULLIF(btrim(m.error_reason), ''), 'sin motivo') AS reason,
               count(*) AS n
          FROM messages m
          JOIN conversations c ON c.id = m.conversation_id
          JOIN scope s ON s.id = c.workspace_id
         WHERE m.status = 'failed'
           AND coalesce(btrim(m.content_text), '') <> '[deleted]'
           AND m.created_at >= now() - interval '6 hours'
         GROUP BY 1, 2
      ) t
  ),

  -- 3 bis) El WhatsApp que el agente prometio EN UNA LLAMADA y no llego.
  -- Basta UNO: en una llamada el agente dice «te lo mando por WhatsApp» y el
  -- cliente cuelga contando con eso.
  voice_fail AS (
    SELECT c.workspace_id,
           count(*) AS n,
           (array_agg(COALESCE(NULLIF(btrim(m.error_reason), ''), 'sin motivo')
                      ORDER BY m.created_at DESC))[1] AS reason,
           (array_agg(c.id ORDER BY m.created_at DESC))[1] AS conversation_id,
           max(m.created_at) AS last_at
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      JOIN scope s ON s.id = c.workspace_id
     WHERE m.status = 'failed'
       AND m.origin = 'voice_agent'
       AND m.created_at >= now() - interval '24 hours'
     GROUP BY 1
  ),

  -- 4) Conexiones caídas. Los canales de mensajería y las tiendas viven en
  -- tablas distintas, pero para el comercio es el mismo problema: algo que
  -- conectó una vez y hoy no funciona. 'uninstalled' NO entra: eso es una
  -- decisión suya, no una falla.
  broken AS (
    SELECT workspace_id,
           count(*) AS n,
           string_agg(label, ', ' ORDER BY at DESC) AS labels,
           (array_agg(label ORDER BY at DESC))[1] AS first_label,
           max(at) AS last_at
      FROM (
        SELECT cc.workspace_id, cc.channel AS label,
               COALESCE(cc.updated_at, cc.created_at) AS at
          FROM channel_connections cc
          JOIN scope s ON s.id = cc.workspace_id
         WHERE cc.status IN ('error', 'expired')
         UNION ALL
        SELECT sc.workspace_id, sc.shop_domain AS label,
               COALESCE(sc.updated_at, sc.created_at) AS at
          FROM shopify_connections sc
          JOIN scope s ON s.id = sc.workspace_id
         WHERE sc.status IN ('error', 'expired')
      ) u
     GROUP BY 1
  ),

  -- 5) WABA bloqueado: no sale NINGUNA plantilla hasta que lo resuelvan en el
  -- panel de Meta (medio de pago, datos fiscales).
  blocked AS (
    SELECT cc.workspace_id,
           count(*) AS n,
           max(COALESCE(cc.updated_at, cc.created_at)) AS last_at
      FROM channel_connections cc
      JOIN scope s ON s.id = cc.workspace_id
     WHERE cc.channel = 'whatsapp'
       AND upper(COALESCE(cc.config ->> 'health_status', '')) = 'BLOCKED'
     GROUP BY 1
  ),

  -- 6) Plantillas rechazadas por Meta: no se pueden usar hasta corregirlas.
  rejected AS (
    SELECT t.workspace_id,
           count(*) AS n,
           (array_agg(t.name ORDER BY COALESCE(t.updated_at, t.created_at) DESC))[1] AS name,
           (array_agg(t.id ORDER BY COALESCE(t.updated_at, t.created_at) DESC))[1] AS template_id,
           max(COALESCE(t.updated_at, t.created_at)) AS last_at
      FROM message_templates t
      JOIN scope s ON s.id = t.workspace_id
     WHERE lower(t.status) = 'rejected'
     GROUP BY 1
  ),

  -- 7) Campañas que quedaron "enviando" y no terminaron.
  stalled AS (
    SELECT b.workspace_id,
           count(*) AS n,
           (array_agg(b.name ORDER BY b.updated_at DESC))[1] AS name,
           (array_agg(b.id ORDER BY b.updated_at DESC))[1] AS broadcast_id,
           max(b.updated_at) AS last_at
      FROM broadcasts b
      JOIN scope s ON s.id = b.workspace_id
     WHERE b.status = 'sending'
       AND b.updated_at < now() - interval '2 hours'
     GROUP BY 1
  ),
  -- 8) UN CANAL QUE DEJO DE RECIBIR.
  --
  -- El modo de falla mas caro que tiene esto, y el unico que no avisa nadie:
  -- "no llegan los mensajes" se ve EXACTAMENTE IGUAL que "no escribio nadie".
  -- Medido el 2026-08-29: la suscripcion de la app apuntaba a un host muerto
  -- desde hacia un mes, y en ese mes los comentarios de Facebook y los DMs de
  -- Messenger solo entraron por el backfill —que no despierta a la IA—. Nadie
  -- lo noto hasta que se fue a mirar a mano.
  --
  -- No mira la causa (callback caido, suscripcion perdida, token revocado,
  -- permiso retirado): mira el sintoma, que es el mismo en todas. Y lo compara
  -- contra el ritmo REAL de ese canal en ese comercio, no contra un numero
  -- fijo: un canal que recibe cien por dia lleva horas de retraso cuando otro
  -- que recibe dos por semana todavia esta dentro de lo normal.
  entrantes AS (
    SELECT c.workspace_id, m.channel, m.created_at
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      JOIN scope s ON s.id = c.workspace_id
     WHERE m.sender_type = 'customer'
       AND m.created_at >= now() - interval '30 days'
  ),
  huecos AS (
    SELECT workspace_id, channel, created_at,
           created_at - lag(created_at) OVER (
             PARTITION BY workspace_id, channel ORDER BY created_at) AS hueco
      FROM entrantes
  ),
  ritmo AS (
    -- p95 y no el promedio: el promedio lo arruina un solo fin de semana largo
    -- y el canal deja de gritar nunca. Pide 30 huecos para que "lo normal"
    -- signifique algo; por debajo de eso no se puede distinguir roto de quieto,
    -- y un aviso que no se puede sostener es peor que ninguno.
    SELECT workspace_id, channel,
           count(*) AS n,
           percentile_cont(0.95) WITHIN GROUP (
             ORDER BY extract(epoch FROM hueco)) AS p95
      FROM huecos
     WHERE hueco IS NOT NULL
     GROUP BY 1, 2
    HAVING count(*) >= 30
       -- Y repartido en SIETE DIAS distintos. Sin esto, una tarde de pruebas
       -- alcanzaba para inventarle una costumbre a un canal: el widget de la
       -- web junto 30 huecos en un rato, quedo con un p95 de cero minutos y a
       -- las seis horas gritaba que estaba roto. Treinta mensajes dicen que
       -- hubo volumen; siete dias dicen que hay habito, que es lo unico contra
       -- lo que tiene sentido medir un silencio.
       AND count(DISTINCT date_trunc('day', created_at)) >= 7
  ),

  -- LA IA CAIDA. Se apago sola y nadie se entera.
  --
  -- `ai_replies` guarda el motivo de cada turno que no salio, y cinco de esos
  -- motivos significan que el problema es NUESTRO o del proveedor, no del
  -- comercio: sin saldo en Anthropic, el proveedor frenando, el proveedor
  -- fallando, un error del modelo, o el turno roto antes de contestar. En los
  -- cinco el cliente recibe "en un momento te responde una persona" y la IA
  -- deja de contestar.
  --
  -- Hasta ahora eso no llegaba a ningun lado: ni aviso, ni correo, ni nada.
  -- El comercio se enteraba mirando las etiquetas de la bandeja una por una.
  --
  -- La ventana es de una hora y el piso de tres: un fallo suelto es ruido de
  -- red y se recupera solo; tres en una hora es que dejo de contestar.
  ia_caida AS (
    SELECT r.workspace_id,
           count(*) AS n,
           max(r.created_at) AS last_at,
           -- El motivo mas frecuente, que es lo que hay que arreglar.
           (array_agg(r.skip_reason ORDER BY r.created_at DESC))[1] AS motivo
      FROM ai_replies r
     WHERE r.created_at > now() - interval '1 hour'
       AND r.skip_reason IN (
             'ai_no_credit', 'ai_rate_limited', 'ai_upstream', 'ai_error', 'failed'
           )
       AND (p_workspace_id IS NULL OR r.workspace_id = p_workspace_id)
     GROUP BY r.workspace_id
    HAVING count(*) >= 3
  ),

  mudo AS (
    SELECT r.workspace_id, r.channel, u.last_in, r.p95,
           now() - u.last_in AS callado
      FROM ritmo r
      JOIN (
        SELECT workspace_id, channel, max(created_at) AS last_in
          FROM entrantes GROUP BY 1, 2
      ) u ON u.workspace_id = r.workspace_id AND u.channel = r.channel
     WHERE EXISTS (
             SELECT 1 FROM channel_connections cc
              WHERE cc.workspace_id = r.workspace_id
                AND cc.channel = r.channel
                AND cc.status = 'connected'
           )
       -- Tres veces el peor silencio normal, y nunca menos de seis horas: sin
       -- ese piso, un canal muy activo gritaria por un almuerzo tranquilo.
       AND now() - u.last_in > greatest(
             interval '6 hours',
             make_interval(secs => r.p95 * 3))
  )

  SELECT workspace_id, 'automation_stuck', 'critical', n, NULL::text,
         automation_id::text, log_id::text, last_at
    FROM stuck
  UNION ALL
  SELECT workspace_id, 'automation_failed', 'critical', n, left(msg, 120),
         automation_id::text, log_id::text, last_at
    FROM failed
  UNION ALL
  SELECT f.workspace_id, 'sends_failing', 'critical', f.n, r.reason,
         f.conversation_id::text, NULL::text, f.last_at
    FROM send_fail f
    LEFT JOIN send_reason r ON r.workspace_id = f.workspace_id AND r.rk = 1
  UNION ALL
  SELECT workspace_id, 'voice_send_failed', 'critical', n, left(reason, 160),
         conversation_id::text, NULL::text, last_at
    FROM voice_fail
  UNION ALL
  SELECT workspace_id, 'connection_error', 'critical', n, labels,
         first_label, NULL::text, last_at
    FROM broken
  UNION ALL
  SELECT workspace_id, 'whatsapp_blocked', 'critical', n, NULL::text,
         'whatsapp', NULL::text, last_at
    FROM blocked
  UNION ALL
  SELECT workspace_id, 'template_rejected', 'warning', n, name,
         template_id::text, NULL::text, last_at
    FROM rejected
  UNION ALL
  SELECT workspace_id, 'broadcast_stalled', 'warning', n, name,
         broadcast_id::text, NULL::text, last_at
    FROM stalled
  UNION ALL
  -- El detalle dice las dos cifras juntas porque una sola no significa nada:
  -- "18 h sin recibir" alarma en WhatsApp y es martes normal en Mercado Libre.
  SELECT workspace_id, 'channel_silent', 'warning', 1,
         channel || '|' || round(extract(epoch FROM callado) / 3600)::text
                || '|' || round(p95 / 3600)::text,
         channel, NULL::text, last_in
    FROM mudo
  UNION ALL
  -- Sin saldo lo arregla el comercio (recargar); lo demas es del proveedor y lo
  -- miramos nosotros. Por eso la audiencia depende del motivo.
  SELECT workspace_id, 'ai_down',
         CASE WHEN motivo = 'ai_no_credit' THEN 'critical' ELSE 'warning' END,
         n, motivo, NULL::text, NULL::text, last_at
    FROM ia_caida;
$$;

REVOKE ALL ON FUNCTION admin_workspace_issues(uuid) FROM PUBLIC, anon, authenticated;
