-- ============================================================
-- 083 — Per-user UI language preference
-- ============================================================
--
-- Stores the language the user picked (in onboarding or in Ajustes) so it
-- syncs across their devices. The cookie `riverz_locale` remains the
-- request-time source of truth (seeded by the proxy from IP/Accept-Language
-- on first visit); this column lets a signed-in user carry their choice to a
-- new device. NULL = no explicit choice yet (fall back to cookie/IP default).
--
-- Values: 'es' | 'en'. Idempotent. Apply via Management API (manual).
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS locale text;
