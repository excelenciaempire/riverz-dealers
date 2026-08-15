-- ============================================================
-- 152 — Qué está roto, en toda la plataforma, de una sola consulta
-- ============================================================
--
-- `collectWorkspaceIssues()` (src/lib/health/issues.ts) ya sabía detectar las
-- siete formas de rotura que le importan a un comercio. El problema era el
-- alcance: son seis consultas por cuenta, así que el panel de plataforma no
-- podía llamarlo en bucle — con 200 comercios eran 1.200 consultas por pantalla.
-- Por eso /admin podía decir "Todo en orden" el mismo día en que un comercio
-- recibía el correo diario con seis problemas.
--
-- Esta función hace los mismos siete chequeos de forma conjunta y sirve a los
-- dos lados:
--
--   * el comercio la llama con su propio id — reemplaza el cuerpo de
--     collectWorkspaceIssues, que mantiene su firma y sus consumidores;
--   * el panel la llama con NULL y recibe la plataforma entera.
--
-- Una implementación, dos consumidores: es la única forma de que las dos
-- pantallas no puedan contradecirse.
--
-- Diferencia deliberada con la versión en JS: los conteos son exactos. La
-- versión anterior traía como mucho 200/100/500 filas y contaba sobre eso, así
-- que un comercio con 900 envíos fallidos veía "500".
--
-- SECURITY INVOKER a propósito, igual que las RPC del panel (migración 125): se
-- llama con la clave de servicio, que no pasa por RLS. EXECUTE revocado de
-- PUBLIC/anon/authenticated.
--
-- Idempotente. Se aplica a mano por la Management API.
-- ============================================================

CREATE OR REPLACE FUNCTION admin_workspace_issues(p_workspace_id UUID DEFAULT NULL)
RETURNS TABLE (
  workspace_id UUID,
  kind         TEXT,
  severity     TEXT,
  count        BIGINT,
  detail       TEXT,
  ref_id       TEXT
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
           (array_agg(l.automation_id ORDER BY l.created_at DESC))[1] AS automation_id
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
           (array_agg(l.error_message ORDER BY l.created_at DESC)
              FILTER (WHERE l.error_message IS NOT NULL))[1] AS msg
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
           count(*) AS n
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

  -- 4) Conexiones caídas. Los canales de mensajería y las tiendas viven en
  -- tablas distintas, pero para el comercio es el mismo problema: algo que
  -- conectó una vez y hoy no funciona. 'uninstalled' NO entra: eso es una
  -- decisión suya, no una falla.
  broken AS (
    SELECT workspace_id, count(*) AS n, string_agg(label, ', ') AS labels
      FROM (
        SELECT cc.workspace_id, cc.channel AS label
          FROM channel_connections cc
          JOIN scope s ON s.id = cc.workspace_id
         WHERE cc.status IN ('error', 'expired')
         UNION ALL
        SELECT sc.workspace_id, sc.shop_domain AS label
          FROM shopify_connections sc
          JOIN scope s ON s.id = sc.workspace_id
         WHERE sc.status IN ('error', 'expired')
      ) u
     GROUP BY 1
  ),

  -- 5) WABA bloqueado: no sale NINGUNA plantilla hasta que lo resuelvan en el
  -- panel de Meta (medio de pago, datos fiscales).
  blocked AS (
    SELECT cc.workspace_id, count(*) AS n
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
           (array_agg(t.name))[1] AS name
      FROM message_templates t
      JOIN scope s ON s.id = t.workspace_id
     WHERE lower(t.status) = 'rejected'
     GROUP BY 1
  ),

  -- 7) Campañas que quedaron "enviando" y no terminaron.
  stalled AS (
    SELECT b.workspace_id,
           count(*) AS n,
           (array_agg(b.name ORDER BY b.updated_at DESC))[1] AS name
      FROM broadcasts b
      JOIN scope s ON s.id = b.workspace_id
     WHERE b.status = 'sending'
       AND b.updated_at < now() - interval '2 hours'
     GROUP BY 1
  )

  SELECT workspace_id, 'automation_stuck', 'critical', n, NULL::text, automation_id::text
    FROM stuck
  UNION ALL
  SELECT workspace_id, 'automation_failed', 'critical', n, left(msg, 120), automation_id::text
    FROM failed
  UNION ALL
  SELECT f.workspace_id, 'sends_failing', 'critical', f.n, r.reason, NULL
    FROM send_fail f
    LEFT JOIN send_reason r ON r.workspace_id = f.workspace_id AND r.rk = 1
  UNION ALL
  SELECT workspace_id, 'connection_error', 'critical', n, labels, NULL FROM broken
  UNION ALL
  SELECT workspace_id, 'whatsapp_blocked', 'critical', n, NULL, NULL FROM blocked
  UNION ALL
  SELECT workspace_id, 'template_rejected', 'warning', n, name, NULL FROM rejected
  UNION ALL
  SELECT workspace_id, 'broadcast_stalled', 'warning', n, name, NULL FROM stalled;
$$;

REVOKE ALL ON FUNCTION admin_workspace_issues(uuid) FROM PUBLIC, anon, authenticated;
