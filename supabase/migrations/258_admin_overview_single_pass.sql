-- Admin overview: aggregate each large event table once instead of rescanning it per metric.
-- Preserves the existing return contract, date boundaries and service-role-only access.
-- Apply before relying on the optimized RPC; a code deployment alone does not apply migrations.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE INDEX IF NOT EXISTS idx_messages_admin_created ON public.messages (created_at);
CREATE INDEX IF NOT EXISTS idx_ai_replies_admin_created ON public.ai_replies (created_at);
CREATE INDEX IF NOT EXISTS idx_voice_calls_admin_created ON public.voice_calls (created_at);
CREATE INDEX IF NOT EXISTS cron_runs_name_started_at_idx ON public.cron_runs (name, started_at DESC);

-- Jump to the next job name through the index, rather than scanning every historical run.
CREATE OR REPLACE FUNCTION public.admin_latest_cron_runs()
RETURNS TABLE (name text, status text, started_at timestamptz, finished_at timestamptz, duration_ms integer, error text)
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$
  WITH RECURSIVE latest AS (
    (SELECT name, status, started_at, finished_at, duration_ms, error
     FROM cron_runs ORDER BY name, started_at DESC LIMIT 1)
    UNION ALL
    SELECT next_run.* FROM latest previous
    CROSS JOIN LATERAL (
      SELECT name, status, started_at, finished_at, duration_ms, error
      FROM cron_runs WHERE name > previous.name
      ORDER BY name, started_at DESC LIMIT 1
    ) next_run
  )
  SELECT * FROM latest;
$$;

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
      count(*) FILTER (WHERE sender_type IN ('agent','bot')) AS outbound,
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

REVOKE ALL ON FUNCTION public.admin_platform_overview(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_platform_overview(timestamptz, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_cron_health()
RETURNS TABLE (name text, status text, started_at timestamptz, finished_at timestamptz,
               duration_ms integer, error text, runs_24h bigint, errors_24h bigint)
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$
  WITH recent AS (
    SELECT name, count(*) AS n, count(*) FILTER (WHERE status = 'error') AS errs
    FROM cron_runs WHERE started_at >= now() - interval '24 hours' GROUP BY name
  )
  SELECT latest.name, latest.status, latest.started_at, latest.finished_at,
         latest.duration_ms, latest.error, COALESCE(recent.n, 0), COALESCE(recent.errs, 0)
  FROM admin_latest_cron_runs() latest LEFT JOIN recent ON recent.name = latest.name
  ORDER BY latest.name;
$$;

REVOKE ALL ON FUNCTION public.admin_latest_cron_runs() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_cron_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_latest_cron_runs() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_cron_health() TO service_role;

COMMIT;
