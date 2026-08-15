-- 154 — Gasto de IA por bolsillo, dentro de la misma RPC de uso
--
-- /admin/uso tarifaba modelo por modelo (tokens_by_model) y /admin/ia tarifaba
-- TODO a la tarifa del modelo más barato, con su propio barrido de hasta 50.000
-- filas de ai_replies reducidas en JS. O sea que el mismo comercio mostraba dos
-- costos distintos en dos pantallas del mismo panel, y pasadas las 50.000 filas
-- el número quedaba corto sin avisar.
--
-- Se agrega `tokens_by_source`: los mismos tokens, agrupados por quién paga
-- (`ai_replies.key_source`), con la misma forma que `tokens_by_model` para que
-- el cálculo del costo sea el mismo de los dos lados.
--
-- Idempotente. Se aplica a mano por la Management API.

DROP FUNCTION IF EXISTS admin_usage_rows(timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION admin_usage_rows(
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
           count(*) FILTER (WHERE m.sender_type IN ('agent','bot')) AS out_n,
           count(*) FILTER (WHERE m.sender_type = 'customer')       AS in_n
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
     WHERE m.created_at >= p_from AND m.created_at < p_to
     GROUP BY 1
  ),
  ai AS (
    SELECT workspace_id,
           count(*) FILTER (WHERE status = 'sent')    AS sent_n,
           count(*) FILTER (WHERE status = 'skipped') AS skip_n,
           count(*) FILTER (WHERE status = 'failed')  AS fail_n,
           COALESCE(sum(prompt_tokens), 0)            AS p_tok,
           COALESCE(sum(completion_tokens), 0)        AS c_tok
      FROM ai_replies
     WHERE created_at >= p_from AND created_at < p_to
     GROUP BY 1
  ),
  vc AS (
    SELECT workspace_id,
           count(*) AS n,
           COALESCE(sum(admin_num(cost, 'minutes')), 0)   AS mins,
           COALESCE(sum(admin_num(cost, 'total_usd')), 0) AS usd
      FROM voice_calls
     WHERE created_at >= p_from AND created_at < p_to
     GROUP BY 1
  ),
  ord AS (
    SELECT workspace_id, count(*) AS n FROM orders
     WHERE created_at >= p_from AND created_at < p_to
     GROUP BY 1
  ),
  ai_by_model AS (
    SELECT r.workspace_id,
           COALESCE(a.model, 'desconocido') AS model,
           COALESCE(sum(r.prompt_tokens), 0)     AS p_tok,
           COALESCE(sum(r.completion_tokens), 0) AS c_tok
      FROM ai_replies r
      LEFT JOIN ai_agents a ON a.id = r.agent_id
     WHERE r.created_at >= p_from AND r.created_at < p_to
     GROUP BY 1, 2
  ),
  ai_models AS (
    SELECT workspace_id,
           jsonb_object_agg(model, jsonb_build_object('prompt', p_tok, 'completion', c_tok)) AS by_model
      FROM ai_by_model
     GROUP BY 1
  ),
  -- Quién paga: la clave de la plataforma o la del propio comercio. Es la
  -- pregunta entera de /admin/ia, y hasta ahora se contestaba en JS.
  ai_by_source AS (
    SELECT r.workspace_id,
           COALESCE(r.key_source, 'desconocido') AS source,
           count(*) FILTER (WHERE r.status = 'sent') AS n,
           COALESCE(sum(r.prompt_tokens) FILTER (WHERE r.status = 'sent'), 0)     AS p_tok,
           COALESCE(sum(r.completion_tokens) FILTER (WHERE r.status = 'sent'), 0) AS c_tok
      FROM ai_replies r
     WHERE r.created_at >= p_from AND r.created_at < p_to
     GROUP BY 1, 2
  ),
  ai_sources AS (
    SELECT workspace_id,
           jsonb_object_agg(source, jsonb_build_object('prompt', p_tok, 'completion', c_tok, 'calls', n)) AS by_source
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
    LEFT JOIN ai  ON ai.workspace_id  = w.id
    LEFT JOIN vc  ON vc.workspace_id  = w.id
    LEFT JOIN ord ON ord.workspace_id = w.id
    LEFT JOIN ai_models ON ai_models.workspace_id = w.id
    LEFT JOIN ai_sources ON ai_sources.workspace_id = w.id
   WHERE w.deleted_at IS NULL
   ORDER BY COALESCE(msg.out_n, 0) + COALESCE(ai.sent_n, 0) + COALESCE(vc.n, 0) DESC;
$$;

REVOKE ALL ON FUNCTION admin_usage_rows(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
