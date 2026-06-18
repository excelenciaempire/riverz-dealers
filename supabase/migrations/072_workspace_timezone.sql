-- 072_workspace_timezone.sql
--
-- Workspace-level IANA timezone — the single "app timezone" that governs
-- ALL analytics day-boundaries (panel cards, conversation/response-time
-- charts, monthly usage) AND the timestamps shown in the inbox. One zone
-- for the whole team, so "hoy / ayer / últimos N días" means the same
-- thing for every member regardless of where they physically connect.
--
-- Supersedes the per-user profiles.timezone (017) as the source for
-- display + metrics. profiles.timezone is left in place (harmless) but is
-- no longer read by the app.
--
-- Default "America/Bogota" — where the initial Vitalú / Pilar Skin team
-- operates. Existing workspaces pick up the default; admins change it from
-- Ajustes → Espacio de trabajo.

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Bogota';
