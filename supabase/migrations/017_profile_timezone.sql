-- 017_profile_timezone.sql
--
-- Per-user IANA timezone. Drives every Date format() call in the
-- inbox so users in Bogotá and users in Madrid see times relative to
-- their own clock instead of whatever timezone the server happened to
-- be on.
--
-- Default "America/Bogota" because that's where the initial Vitalú
-- / Pilar Skin team operates. Existing rows pick up the default.
-- Users can change it from Ajustes → Perfil.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Bogota';
