-- ============================================================
-- 071_dashboard_realtime.sql
--
-- The home dashboard (/panel) now subscribes to Supabase Realtime so its
-- metric cards, charts and activity feed update live as data lands —
-- instead of being a one-shot snapshot taken at page load.
--
-- `messages` and `conversations` are already published (001). The
-- dashboard also reads `contacts` (new-contacts card / activity),
-- `broadcasts` (activity) and `automation_logs` (activity), so those
-- three need to emit postgres_changes too. RLS still gates every event
-- by workspace membership — adding a table to the publication does NOT
-- widen access.
--
-- Idempotent: re-running is a no-op (guards on pg_publication_tables).
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'contacts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE contacts;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'broadcasts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE broadcasts;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'automation_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE automation_logs;
  END IF;
END $$;
