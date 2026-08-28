-- ============================================================
-- 210 — El aviso lleva al lugar exacto, y se puede ocultar de verdad
-- ============================================================
--
-- Dos problemas de la tarjeta "Necesita tu atención" (migraciones 152 y 204):
--
-- 1) El clic no llevaba al error. `sends_failing` y `voice_send_failed` abrían
--    /bandeja —la lista entera— y las corridas fallidas abrían la pantalla de
--    la automatización, no la corrida. Quien lee el aviso ya sabe que algo
--    falló; lo que necesita es la fila. Ahora cada aviso viaja con el id de la
--    cosa concreta: la conversación, la corrida, la plantilla, la campaña.
--
-- 2) "Ocultar" no ocultaba. Se guardaba en localStorage una firma que incluía
--    el CONTEO, así que el mismo problema volvía a aparecer con el siguiente
--    fallo, y encima sólo valía para ese navegador. Ahora se guarda en la base,
--    por cuenta, y hasta QUÉ MOMENTO se ocultó: si vuelve a pasar después de
--    eso, el aviso reaparece — que es lo único que justifica interrumpir.
--
-- Cambia la forma de salida (`ref_child`, `last_at`), así que hay DROP: no se
-- puede REPLACE una función cambiándole las columnas.
--
-- Aplicada A MANO por la Management API (no corre en el deploy de Render).
-- ============================================================

DROP FUNCTION IF EXISTS admin_workspace_issues(uuid);

CREATE FUNCTION admin_workspace_issues(p_workspace_id UUID DEFAULT NULL)
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
    FROM stalled;
$$;

REVOKE ALL ON FUNCTION admin_workspace_issues(uuid) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- Avisos ocultados. No es "ya lo vi": es "ocultá lo que pasó HASTA acá".
-- Si el mismo problema vuelve a ocurrir más tarde, `last_at` supera a
-- `hidden_through` y el aviso reaparece. Por cuenta y no por persona: la
-- operación es del equipo, y dos personas viendo listas distintas de lo que
-- está roto es peor que verlo dos veces.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS health_issue_dismissals (
  workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,
  -- '' cuando el aviso no apunta a una fila concreta.
  ref_id         TEXT NOT NULL DEFAULT '',
  hidden_through TIMESTAMPTZ NOT NULL,
  dismissed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  dismissed_by   UUID,
  PRIMARY KEY (workspace_id, kind, ref_id)
);

COMMENT ON TABLE health_issue_dismissals IS
  'Avisos de "Necesita tu atención" ocultados por el comercio, hasta el instante hidden_through.';

ALTER TABLE health_issue_dismissals ENABLE ROW LEVEL SECURITY;
-- Sin políticas: se lee y escribe sólo con la clave de servicio, igual que la
-- función de arriba. El navegador nunca la toca directo.
