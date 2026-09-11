-- Dense daytime conversations must not erase normal overnight gaps.
-- Preserve the current function and change only its silence detector.
DO $migration$
DECLARE
  original text := pg_get_functiondef('public.admin_workspace_issues(uuid)'::regprocedure);
  revised text;
BEGIN
  IF position('health_daily_silence_baseline' IN original) > 0 THEN RETURN; END IF;
  revised := replace(original, '  ritmo AS (', $replacement$
  -- health_daily_silence_baseline: each day contributes one longest gap.
  pausas_diarias AS (
    SELECT workspace_id, channel, date_trunc('day', created_at) AS dia,
           max(extract(epoch FROM hueco)) AS pausa
      FROM huecos
     WHERE hueco IS NOT NULL
     GROUP BY 1, 2, 3
  ),
  pausas_habituales AS (
    SELECT workspace_id, channel,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY pausa) AS p95_diario
      FROM pausas_diarias
     GROUP BY 1, 2
  ),
  ritmo AS ($replacement$);
  IF revised = original THEN RAISE EXCEPTION 'health rhythm CTE not found'; END IF;
  original := revised;
  revised := replace(revised, '      FROM ritmo r',
    '      FROM ritmo r JOIN pausas_habituales ph USING (workspace_id, channel)');
  IF revised = original THEN RAISE EXCEPTION 'health silence join not found'; END IF;
  original := revised;
  revised := replace(revised, 'make_interval(secs => r.p95 * 3))',
    'make_interval(secs => r.p95 * 3), make_interval(secs => ph.p95_diario + 7200))');
  IF revised = original THEN RAISE EXCEPTION 'health silence threshold not found'; END IF;
  EXECUTE revised;
END;
$migration$;
