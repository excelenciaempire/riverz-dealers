-- 263 — Borrado en lotes del lado de la base para la retención operativa.
--
-- El barrendero diario (`/api/cron/pii-purge`) borraba `cron_runs` pidiendo
-- 5.000 ids a PostgREST y mandándolos de vuelta en `?id=in.(...)`. Esa URL
-- mide ~190 KB y Cloudflare la rechaza con 414 antes de que llegue a
-- PostgREST. El error se tragaba como warn y la corrida quedaba en `ok`, así
-- que la tabla nunca se vació: el 2026-09-17 tenía 924.630 filas (241 MB, más
-- que todos los mensajes juntos) sobre una instancia Nano de 0,5 GB, y la base
-- se quedó sin memoria hasta colgarse.
--
-- Esta función hace el lote entero adentro de Postgres: elige hasta `p_batch`
-- filas más viejas que el corte y las borra por ctid, sin que un solo id viaje
-- por la red. Devuelve cuántas borró para que el llamador sepa si sigue.
CREATE OR REPLACE FUNCTION public.purge_rows_older_than(
  p_table text,
  p_column text,
  p_cutoff timestamptz,
  p_batch integer DEFAULT 5000,
  p_only_processed boolean DEFAULT false
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
  v_extra text := '';
BEGIN
  IF p_table NOT IN ('cron_runs', 'webhook_events_raw') THEN
    RAISE EXCEPTION 'purge_rows_older_than: tabla no permitida: %', p_table;
  END IF;
  IF p_batch < 1 OR p_batch > 50000 THEN
    RAISE EXCEPTION 'purge_rows_older_than: lote fuera de rango: %', p_batch;
  END IF;
  IF p_only_processed THEN
    v_extra := ' AND processed_at IS NOT NULL';
  END IF;

  EXECUTE format(
    'DELETE FROM %I WHERE ctid = ANY(ARRAY(SELECT ctid FROM %I WHERE %I < $1%s LIMIT $2))',
    p_table, p_table, p_column, v_extra
  ) USING p_cutoff, p_batch;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_rows_older_than(text, text, timestamptz, integer, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_rows_older_than(text, text, timestamptz, integer, boolean) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_rows_older_than(text, text, timestamptz, integer, boolean) TO service_role;

COMMENT ON FUNCTION public.purge_rows_older_than IS
  'Borra hasta p_batch filas de cron_runs o webhook_events_raw más viejas que p_cutoff. Sólo service_role; la usa /api/cron/pii-purge.';
