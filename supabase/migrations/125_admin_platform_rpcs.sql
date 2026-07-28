-- ============================================================
-- 125: Cross-tenant aggregates for the platform admin panel
-- ============================================================
-- Every query helper in the app resolves ONE workspace_id first — by design,
-- that is the multi-tenant guarantee. The /admin panel is the one place that
-- legitimately needs to look across all of them, and doing that by paging
-- PostgREST in JS (as src/lib/dashboard/queries.ts does per workspace, capped
-- at 1000 rows) does not scale platform-wide. So the aggregation happens here,
-- in SQL, one pass per table.
--
-- SECURITY: these are SECURITY INVOKER (the default) on purpose. They are
-- called with the service-role client, which already bypasses RLS, so they
-- need no elevated rights of their own — and EXECUTE is revoked from PUBLIC /
-- anon / authenticated so a logged-in merchant can never call them even if a
-- route leaked. Making them SECURITY DEFINER would have created a real
-- privilege-escalation surface for zero benefit.
--
-- PRIVACY: no function here returns the body of a message, a contact's name,
-- phone, email or address. The panel is metadata-only by decision; keep it
-- that way when extending these.
--
-- Apply MANUALLY via the Supabase Management API.
-- ============================================================

-- ------------------------------------------------------------
-- Helper: read a numeric out of a JSONB blob without ever throwing.
-- voice_calls.cost is written by our own worker, but one malformed row must
-- not be able to take down the whole admin overview.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_num(p_obj JSONB, p_key TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN (p_obj ->> p_key)::NUMERIC;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

-- ------------------------------------------------------------
-- 1) Platform overview — the numbers on /admin, for a date range.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_platform_overview(
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
    (SELECT count(*) FROM workspaces),
    (SELECT count(*) FROM workspaces WHERE deleted_at IS NULL),
    (SELECT count(*) FROM workspaces WHERE deleted_at IS NOT NULL),
    (SELECT count(*) FROM workspaces WHERE created_at >= p_from AND created_at < p_to),
    (SELECT count(DISTINCT user_id) FROM workspace_members),
    (SELECT count(*) FROM contacts),
    (SELECT count(*) FROM conversations WHERE deleted_at IS NULL),
    (SELECT count(*) FROM conversations
       WHERE created_at >= p_from AND created_at < p_to
         AND deleted_at IS NULL),
    (SELECT count(*) FROM messages
       WHERE created_at >= p_from AND created_at < p_to
         AND sender_type = 'customer'),
    (SELECT count(*) FROM messages
       WHERE created_at >= p_from AND created_at < p_to
         AND sender_type IN ('agent','bot')),
    (SELECT count(*) FROM messages
       WHERE created_at >= p_from AND created_at < p_to
         AND status = 'failed'),
    (SELECT count(*) FROM ai_replies
       WHERE created_at >= p_from AND created_at < p_to AND status = 'sent'),
    (SELECT count(*) FROM ai_replies
       WHERE created_at >= p_from AND created_at < p_to AND status = 'skipped'),
    (SELECT count(*) FROM ai_replies
       WHERE created_at >= p_from AND created_at < p_to AND status = 'failed'),
    (SELECT COALESCE(sum(prompt_tokens), 0) FROM ai_replies
       WHERE created_at >= p_from AND created_at < p_to),
    (SELECT COALESCE(sum(completion_tokens), 0) FROM ai_replies
       WHERE created_at >= p_from AND created_at < p_to),
    (SELECT count(*) FROM voice_calls
       WHERE created_at >= p_from AND created_at < p_to),
    (SELECT COALESCE(sum(admin_num(cost, 'minutes')), 0) FROM voice_calls
       WHERE created_at >= p_from AND created_at < p_to),
    (SELECT COALESCE(sum(admin_num(cost, 'total_usd')), 0) FROM voice_calls
       WHERE created_at >= p_from AND created_at < p_to),
    (SELECT count(*) FROM orders
       WHERE created_at >= p_from AND created_at < p_to),
    (SELECT count(*) FROM channel_connections WHERE status = 'connected'),
    (SELECT count(*) FROM channel_connections WHERE status IN ('error','expired')),
    (SELECT count(*) FROM webhook_events_raw WHERE processed_at IS NULL),
    (SELECT count(*) FROM (
        SELECT DISTINCT ON (name) status
          FROM cron_runs ORDER BY name, started_at DESC
     ) latest WHERE latest.status = 'error');
$$;

-- ------------------------------------------------------------
-- 2) Daily series for the sparklines on /admin.
-- One row per day in range, zero-filled so the chart has no gaps.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_activity_series(
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
           count(*) FILTER (WHERE sender_type = 'customer')        AS m_in,
           count(*) FILTER (WHERE sender_type IN ('agent','bot'))  AS m_out
      FROM messages
     WHERE created_at >= p_from AND created_at < p_to
     GROUP BY 1
  ),
  ai AS (
    SELECT date_trunc('day', created_at)::DATE AS day, count(*) AS n
      FROM ai_replies
     WHERE created_at >= p_from AND created_at < p_to
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
    LEFT JOIN ai  ON ai.day  = d.day
    LEFT JOIN vc  ON vc.day  = d.day
    LEFT JOIN ct  ON ct.day  = d.day
   ORDER BY d.day;
$$;

-- ------------------------------------------------------------
-- 3) One row per workspace — the /admin/comercios table.
-- Counts are computed as grouped CTEs (one pass per table) rather than
-- per-row subqueries, so cost grows with the data, not with tenant count.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_workspace_rows(
  p_search TEXT DEFAULT NULL,
  p_limit  INT  DEFAULT 100,
  p_offset INT  DEFAULT 0
)
RETURNS TABLE (
  id                    UUID,
  name                  TEXT,
  slug                  TEXT,
  timezone              TEXT,
  created_at            TIMESTAMPTZ,
  deleted_at            TIMESTAMPTZ,
  owner_email           TEXT,
  owner_name            TEXT,
  members               BIGINT,
  connections_total     BIGINT,
  connections_connected BIGINT,
  connections_broken    BIGINT,
  contacts              BIGINT,
  conversations         BIGINT,
  agents                BIGINT,
  agents_active         BIGINT,
  last_activity_at      TIMESTAMPTZ,
  total_count           BIGINT
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH filtered AS (
    SELECT w.*
      FROM workspaces w
      LEFT JOIN profiles p ON p.user_id = w.owner_id
     WHERE p_search IS NULL
        OR p_search = ''
        OR w.name  ILIKE '%' || p_search || '%'
        OR w.slug  ILIKE '%' || p_search || '%'
        OR p.email ILIKE '%' || p_search || '%'
  ),
  total AS (SELECT count(*) AS n FROM filtered),
  page AS (
    SELECT * FROM filtered
     ORDER BY created_at DESC NULLS LAST
     LIMIT GREATEST(p_limit, 0) OFFSET GREATEST(p_offset, 0)
  ),
  mem AS (
    SELECT workspace_id, count(*) AS n FROM workspace_members
     WHERE workspace_id IN (SELECT id FROM page) GROUP BY 1
  ),
  conn AS (
    SELECT workspace_id,
           count(*) AS n,
           count(*) FILTER (WHERE status = 'connected')          AS ok,
           count(*) FILTER (WHERE status IN ('error','expired')) AS broken
      FROM channel_connections
     WHERE workspace_id IN (SELECT id FROM page) GROUP BY 1
  ),
  cts AS (
    SELECT workspace_id, count(*) AS n FROM contacts
     WHERE workspace_id IN (SELECT id FROM page) GROUP BY 1
  ),
  conv AS (
    SELECT workspace_id,
           count(*) AS n,
           max(last_message_at) AS last_at
      FROM conversations
     WHERE workspace_id IN (SELECT id FROM page) GROUP BY 1
  ),
  ag AS (
    SELECT workspace_id,
           count(*) AS n,
           count(*) FILTER (WHERE is_active) AS active
      FROM ai_agents
     WHERE workspace_id IN (SELECT id FROM page) GROUP BY 1
  )
  SELECT page.id,
         page.name,
         page.slug,
         page.timezone,
         page.created_at,
         page.deleted_at,
         p.email,
         p.full_name,
         COALESCE(mem.n, 0),
         COALESCE(conn.n, 0),
         COALESCE(conn.ok, 0),
         COALESCE(conn.broken, 0),
         COALESCE(cts.n, 0),
         COALESCE(conv.n, 0),
         COALESCE(ag.n, 0),
         COALESCE(ag.active, 0),
         conv.last_at,
         (SELECT n FROM total)
    FROM page
    LEFT JOIN profiles p ON p.user_id = page.owner_id
    LEFT JOIN mem  ON mem.workspace_id  = page.id
    LEFT JOIN conn ON conn.workspace_id = page.id
    LEFT JOIN cts  ON cts.workspace_id  = page.id
    LEFT JOIN conv ON conv.workspace_id = page.id
    LEFT JOIN ag   ON ag.workspace_id   = page.id
   ORDER BY page.created_at DESC NULLS LAST;
$$;

-- ------------------------------------------------------------
-- 4) Usage and cost per workspace — the /admin/uso table.
-- The AI token columns have been written on every dispatch since migration
-- 024 and never read by anything until now.
-- ------------------------------------------------------------
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
  tokens_by_model   JSONB
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
  -- Desglose de tokens por modelo: cada agente puede tener el suyo, y las
  -- tarifas difieren hasta 10x entre Haiku y Opus. Sin esto el costo sería un
  -- promedio inventado.
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
           jsonb_object_agg(
             model,
             jsonb_build_object('prompt', p_tok, 'completion', c_tok)
           ) AS by_model
      FROM ai_by_model
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
         COALESCE(ai_models.by_model, '{}'::jsonb)
    FROM workspaces w
    LEFT JOIN profiles p ON p.user_id = w.owner_id
    LEFT JOIN msg ON msg.workspace_id = w.id
    LEFT JOIN ai  ON ai.workspace_id  = w.id
    LEFT JOIN vc  ON vc.workspace_id  = w.id
    LEFT JOIN ord ON ord.workspace_id = w.id
    LEFT JOIN ai_models ON ai_models.workspace_id = w.id
   WHERE w.deleted_at IS NULL
   ORDER BY COALESCE(msg.out_n, 0) + COALESCE(ai.sent_n, 0) + COALESCE(vc.n, 0) DESC;
$$;

-- ------------------------------------------------------------
-- 5) Users across the platform — the /admin/usuarios table.
-- Reads `profiles` (not auth.users) so no password/token metadata is ever in
-- reach; the workspaces each user belongs to come back as a JSON array.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_user_rows(
  p_search TEXT DEFAULT NULL,
  p_limit  INT  DEFAULT 100,
  p_offset INT  DEFAULT 0
)
RETURNS TABLE (
  user_id           UUID,
  email             TEXT,
  full_name         TEXT,
  locale            TEXT,
  timezone          TEXT,
  created_at        TIMESTAMPTZ,
  terms_version     TEXT,
  terms_accepted_at TIMESTAMPTZ,
  workspaces        JSONB,
  total_count       BIGINT
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH filtered AS (
    SELECT p.* FROM profiles p
     WHERE p_search IS NULL
        OR p_search = ''
        OR p.email     ILIKE '%' || p_search || '%'
        OR p.full_name ILIKE '%' || p_search || '%'
  ),
  total AS (SELECT count(*) AS n FROM filtered),
  page AS (
    SELECT * FROM filtered
     ORDER BY created_at DESC NULLS LAST
     LIMIT GREATEST(p_limit, 0) OFFSET GREATEST(p_offset, 0)
  ),
  ws AS (
    SELECT wm.user_id,
           jsonb_agg(
             jsonb_build_object(
               'id',    w.id,
               'name',  w.name,
               'role',  wm.role,
               'owner', (w.owner_id = wm.user_id)
             ) ORDER BY w.name
           ) AS items
      FROM workspace_members wm
      JOIN workspaces w ON w.id = wm.workspace_id
     WHERE wm.user_id IN (SELECT user_id FROM page)
     GROUP BY wm.user_id
  )
  SELECT page.user_id,
         page.email,
         page.full_name,
         page.locale,
         page.timezone,
         page.created_at,
         page.terms_version,
         page.terms_accepted_at,
         COALESCE(ws.items, '[]'::jsonb),
         (SELECT n FROM total)
    FROM page
    LEFT JOIN ws ON ws.user_id = page.user_id
   ORDER BY page.created_at DESC NULLS LAST;
$$;

-- ------------------------------------------------------------
-- 6) Cron health — the latest run of each named job.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_cron_health()
RETURNS TABLE (
  name        TEXT,
  status      TEXT,
  started_at  TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  error       TEXT,
  runs_24h    BIGINT,
  errors_24h  BIGINT
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH latest AS (
    SELECT DISTINCT ON (name)
           name, status, started_at, finished_at, duration_ms, error
      FROM cron_runs
     ORDER BY name, started_at DESC
  ),
  recent AS (
    SELECT name,
           count(*) AS n,
           count(*) FILTER (WHERE status = 'error') AS errs
      FROM cron_runs
     WHERE started_at >= now() - interval '24 hours'
     GROUP BY name
  )
  SELECT latest.name,
         latest.status,
         latest.started_at,
         latest.finished_at,
         latest.duration_ms,
         latest.error,
         COALESCE(recent.n, 0),
         COALESCE(recent.errs, 0)
    FROM latest
    LEFT JOIN recent ON recent.name = latest.name
   ORDER BY latest.name;
$$;

-- ------------------------------------------------------------
-- Lock the door: only the service role may execute these.
-- ------------------------------------------------------------
DO $$
DECLARE fn TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'admin_num(jsonb, text)',
    'admin_platform_overview(timestamptz, timestamptz)',
    'admin_activity_series(timestamptz, timestamptz)',
    'admin_workspace_rows(text, int, int)',
    'admin_usage_rows(timestamptz, timestamptz)',
    'admin_user_rows(text, int, int)',
    'admin_cron_health()'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;
