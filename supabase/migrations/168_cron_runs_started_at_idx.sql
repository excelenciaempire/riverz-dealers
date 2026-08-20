-- La consulta de salud de los trabajos tardaba más de un segundo.
--
-- `admin_cron_health` cuenta las corridas de las últimas 24 h, y el único
-- índice útil era (name, started_at): con `started_at` en segunda posición hay
-- que recorrer el índice ENTERO (500 mil filas, 104 MB) para filtrar por fecha.
-- Medido: 1,26 s el agregado, y hasta 5 s la primera llamada de una instancia
-- recién arrancada. Esa lentitud es la que hacía fallar la lectura cada tanto,
-- y una lectura fallida se leía como "los 41 trabajos están muertos" (ver
-- api/cron/platform-watch).
--
-- El mismo índice acelera la purga diaria, que borra por `started_at`.

CREATE INDEX IF NOT EXISTS cron_runs_started_at_idx
  ON cron_runs (started_at DESC);

-- Y la parte cara de `admin_cron_health`: el DISTINCT ON recorría las 500 mil
-- filas del índice para quedarse con 42. El trabajo menos frecuente del
-- catálogo corre una vez por día, así que mirar 7 días alcanza y sobra: lo que
-- no aparece en esa ventana está muerto, no ausente, y quien llama ya lo trata
-- como tal (isStale con última corrida nula = atrasado).
CREATE OR REPLACE FUNCTION admin_cron_health()
RETURNS TABLE (
  name text,
  status text,
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms integer,
  error text,
  runs_24h bigint,
  errors_24h bigint
)
LANGUAGE sql
AS $$
  WITH latest AS (
    SELECT DISTINCT ON (name)
           name, status, started_at, finished_at, duration_ms, error
      FROM cron_runs
     WHERE started_at >= now() - interval '7 days'
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
