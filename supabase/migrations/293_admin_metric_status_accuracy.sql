-- Las tarjetas y sus series deben medir exactamente lo mismo.
--
-- Antes, "Mensajes enviados" contaba también los que terminaron en failed o
-- seguían en sending, y la serie de "Respuestas de IA" contaba sent + skipped
-- + failed mientras la tarjeta contaba sólo sent. Dos números con el mismo
-- nombre podían diferir por miles sin que el panel explicara por qué.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_platform_overview(
  p_from TIMESTAMPTZ,
  p_to   TIMESTAMPTZ
)
RETURNS TABLE (
  workspaces_total        BIGINT,
  workspaces_active       BIGINT,
  workspaces_deleted      BIGINT,
  workspaces_new          BIGINT,
  users_total             BIGINT,
  contacts_total          BIGINT,
  conversations_total     BIGINT,
  conversations_new       BIGINT,
  messages_in             BIGINT,
  messages_out            BIGINT,
  messages_failed         BIGINT,
  ai_sent                 BIGINT,
  ai_skipped              BIGINT,
  ai_failed               BIGINT,
  ai_prompt_tokens        BIGINT,
  ai_completion_tokens    BIGINT,
  calls_total             BIGINT,
  calls_minutes           NUMERIC,
  calls_cost_usd          NUMERIC,
  orders_total            BIGINT,
  connections_connected   BIGINT,
  connections_error       BIGINT,
  webhooks_unprocessed    BIGINT,
  crons_error             BIGINT
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    w.total, w.active, w.deleted, w.new,
    (SELECT count(DISTINCT user_id) FROM workspace_members),
    (SELECT count(*) FROM contacts),
    c.total, c.new,
    m.inbound, m.outbound, m.failed,
    a.sent, a.skipped, a.failed, a.prompt, a.completion,
    v.total, v.minutes, v.cost,
    (SELECT count(*) FROM orders WHERE created_at >= p_from AND created_at < p_to),
    cn.connected, cn.error,
    (SELECT count(*) FROM webhook_events_raw WHERE processed_at IS NULL),
    (SELECT count(*) FROM admin_latest_cron_runs() WHERE status = 'error')
  FROM (
    SELECT count(*) AS total,
      count(*) FILTER (WHERE deleted_at IS NULL) AS active,
      count(*) FILTER (WHERE deleted_at IS NOT NULL) AS deleted,
      count(*) FILTER (WHERE created_at >= p_from AND created_at < p_to) AS new
    FROM workspaces
  ) w CROSS JOIN (
    SELECT count(*) AS total,
      count(*) FILTER (WHERE created_at >= p_from AND created_at < p_to) AS new
    FROM conversations WHERE deleted_at IS NULL
  ) c CROSS JOIN (
    SELECT count(*) FILTER (WHERE sender_type = 'customer') AS inbound,
      count(*) FILTER (
        WHERE sender_type IN ('agent','bot')
          AND status IN ('sent','delivered','read')
      ) AS outbound,
      count(*) FILTER (WHERE status = 'failed') AS failed
    FROM messages WHERE created_at >= p_from AND created_at < p_to
  ) m CROSS JOIN (
    SELECT count(*) FILTER (WHERE status = 'sent') AS sent,
      count(*) FILTER (WHERE status = 'skipped') AS skipped,
      count(*) FILTER (WHERE status = 'failed') AS failed,
      COALESCE(sum(prompt_tokens), 0)::bigint AS prompt,
      COALESCE(sum(completion_tokens), 0)::bigint AS completion
    FROM ai_replies WHERE created_at >= p_from AND created_at < p_to
  ) a CROSS JOIN (
    SELECT count(*) AS total,
      COALESCE(sum(admin_num(cost, 'minutes')), 0) AS minutes,
      COALESCE(sum(admin_num(cost, 'total_usd')), 0) AS cost
    FROM voice_calls WHERE created_at >= p_from AND created_at < p_to
  ) v CROSS JOIN (
    SELECT count(*) FILTER (WHERE status = 'connected') AS connected,
      count(*) FILTER (WHERE status IN ('error','expired')) AS error
    FROM channel_connections
  ) cn;
$$;

CREATE OR REPLACE FUNCTION public.admin_activity_series(
  p_from TIMESTAMPTZ,
  p_to   TIMESTAMPTZ
)
RETURNS TABLE (
  day           DATE,
  messages_in   BIGINT,
  messages_out  BIGINT,
  ai_replies    BIGINT,
  calls         BIGINT,
  new_contacts  BIGINT
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH days AS (
    SELECT generate_series(
      date_trunc('day', p_from),
      date_trunc('day', p_to - interval '1 microsecond'),
      interval '1 day'
    )::DATE AS day
  ),
  msg AS (
    SELECT date_trunc('day', created_at)::DATE AS day,
      count(*) FILTER (WHERE sender_type = 'customer') AS m_in,
      count(*) FILTER (
        WHERE sender_type IN ('agent','bot')
          AND status IN ('sent','delivered','read')
      ) AS m_out
    FROM messages
    WHERE created_at >= p_from AND created_at < p_to
    GROUP BY 1
  ),
  ai AS (
    SELECT date_trunc('day', created_at)::DATE AS day, count(*) AS n
    FROM ai_replies
    WHERE created_at >= p_from AND created_at < p_to AND status = 'sent'
    GROUP BY 1
  ),
  vc AS (
    SELECT date_trunc('day', created_at)::DATE AS day, count(*) AS n
    FROM voice_calls
    WHERE created_at >= p_from AND created_at < p_to
    GROUP BY 1
  ),
  ct AS (
    SELECT date_trunc('day', created_at)::DATE AS day, count(*) AS n
    FROM contacts
    WHERE created_at >= p_from AND created_at < p_to
    GROUP BY 1
  )
  SELECT d.day,
    COALESCE(msg.m_in, 0),
    COALESCE(msg.m_out, 0),
    COALESCE(ai.n, 0),
    COALESCE(vc.n, 0),
    COALESCE(ct.n, 0)
  FROM days d
  LEFT JOIN msg ON msg.day = d.day
  LEFT JOIN ai  ON ai.day = d.day
  LEFT JOIN vc  ON vc.day = d.day
  LEFT JOIN ct  ON ct.day = d.day
  ORDER BY d.day;
$$;

CREATE OR REPLACE FUNCTION public.admin_usage_rows(
  p_from TIMESTAMPTZ,
  p_to   TIMESTAMPTZ
)
RETURNS TABLE (
  workspace_id      UUID,
  workspace_name    TEXT,
  owner_email       TEXT,
  messages_out      BIGINT,
  messages_in       BIGINT,
  ai_sent           BIGINT,
  ai_skipped        BIGINT,
  ai_failed         BIGINT,
  prompt_tokens     BIGINT,
  completion_tokens BIGINT,
  calls             BIGINT,
  call_minutes      NUMERIC,
  call_cost_usd     NUMERIC,
  orders            BIGINT,
  tokens_by_model   JSONB,
  tokens_by_source  JSONB
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH msg AS (
    SELECT c.workspace_id,
      count(*) FILTER (
        WHERE m.sender_type IN ('agent','bot')
          AND m.status IN ('sent','delivered','read')
      ) AS out_n,
      count(*) FILTER (WHERE m.sender_type = 'customer') AS in_n
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.created_at >= p_from AND m.created_at < p_to
    GROUP BY 1
  ),
  ai AS (
    SELECT workspace_id,
      count(*) FILTER (WHERE status = 'sent') AS sent_n,
      count(*) FILTER (WHERE status = 'skipped') AS skip_n,
      count(*) FILTER (WHERE status = 'failed') AS fail_n,
      COALESCE(sum(prompt_tokens), 0) AS p_tok,
      COALESCE(sum(completion_tokens), 0) AS c_tok
    FROM ai_replies
    WHERE created_at >= p_from AND created_at < p_to
    GROUP BY 1
  ),
  vc AS (
    SELECT workspace_id,
      count(*) AS n,
      COALESCE(sum(admin_num(cost, 'minutes')), 0) AS mins,
      COALESCE(sum(admin_num(cost, 'total_usd')), 0) AS usd
    FROM voice_calls
    WHERE created_at >= p_from AND created_at < p_to
    GROUP BY 1
  ),
  ord AS (
    SELECT workspace_id, count(*) AS n
    FROM orders
    WHERE created_at >= p_from AND created_at < p_to
    GROUP BY 1
  ),
  ai_by_model AS (
    SELECT r.workspace_id,
      COALESCE(a.model, 'desconocido') AS model,
      COALESCE(sum(r.prompt_tokens), 0) AS p_tok,
      COALESCE(sum(r.completion_tokens), 0) AS c_tok
    FROM ai_replies r
    LEFT JOIN ai_agents a ON a.id = r.agent_id
    WHERE r.created_at >= p_from AND r.created_at < p_to
    GROUP BY 1, 2
  ),
  ai_models AS (
    SELECT workspace_id,
      jsonb_object_agg(
        model,
        jsonb_build_object('prompt', p_tok, 'completion', c_tok)
      ) AS by_model
    FROM ai_by_model
    GROUP BY 1
  ),
  ai_by_source AS (
    SELECT r.workspace_id,
      COALESCE(r.key_source, 'desconocido') AS source,
      count(*) FILTER (WHERE r.status = 'sent') AS n,
      COALESCE(sum(r.prompt_tokens) FILTER (WHERE r.status = 'sent'), 0) AS p_tok,
      COALESCE(sum(r.completion_tokens) FILTER (WHERE r.status = 'sent'), 0) AS c_tok
    FROM ai_replies r
    WHERE r.created_at >= p_from AND r.created_at < p_to
    GROUP BY 1, 2
  ),
  ai_sources AS (
    SELECT workspace_id,
      jsonb_object_agg(
        source,
        jsonb_build_object('prompt', p_tok, 'completion', c_tok, 'calls', n)
      ) AS by_source
    FROM ai_by_source
    GROUP BY 1
  )
  SELECT w.id,
    w.name,
    p.email,
    COALESCE(msg.out_n, 0),
    COALESCE(msg.in_n, 0),
    COALESCE(ai.sent_n, 0),
    COALESCE(ai.skip_n, 0),
    COALESCE(ai.fail_n, 0),
    COALESCE(ai.p_tok, 0),
    COALESCE(ai.c_tok, 0),
    COALESCE(vc.n, 0),
    COALESCE(vc.mins, 0),
    COALESCE(vc.usd, 0),
    COALESCE(ord.n, 0),
    COALESCE(ai_models.by_model, '{}'::jsonb),
    COALESCE(ai_sources.by_source, '{}'::jsonb)
  FROM workspaces w
  LEFT JOIN profiles p ON p.user_id = w.owner_id
  LEFT JOIN msg ON msg.workspace_id = w.id
  LEFT JOIN ai ON ai.workspace_id = w.id
  LEFT JOIN vc ON vc.workspace_id = w.id
  LEFT JOIN ord ON ord.workspace_id = w.id
  LEFT JOIN ai_models ON ai_models.workspace_id = w.id
  LEFT JOIN ai_sources ON ai_sources.workspace_id = w.id
  WHERE w.deleted_at IS NULL
  ORDER BY COALESCE(msg.out_n, 0) + COALESCE(ai.sent_n, 0) + COALESCE(vc.n, 0) DESC;
$$;

REVOKE ALL ON FUNCTION public.admin_platform_overview(timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_activity_series(timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_usage_rows(timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_platform_overview(timestamptz, timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_activity_series(timestamptz, timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_usage_rows(timestamptz, timestamptz)
  TO service_role;

COMMIT;
