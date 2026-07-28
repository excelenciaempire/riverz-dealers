-- ============================================================
-- 123: Feature flags — platform-wide kill switches
-- ============================================================
-- A flag turns a whole product area off for EVERY merchant: it disappears
-- from the sidebar and its URL is blocked (SectionGuard redirects). Platform
-- admins always keep access so they can test a feature while it's dark.
--
-- Design note: a feature with NO row is ENABLED. That way introducing this
-- table (and later adding new features to the catalog) never turns anything
-- off by accident — only an explicit `enabled = false` hides something.
-- `src/lib/admin/feature-flags.ts` also fails soft: on any read error it
-- returns {} and everything stays on.
--
-- RLS enabled with NO policies → service-role only. Merchants never read this
-- table directly; the dashboard layout loads it server-side with the admin
-- client and pushes the result down through FeatureFlagsProvider.
--
-- Apply MANUALLY via the Supabase Management API.
-- ============================================================

CREATE TABLE IF NOT EXISTS feature_flags (
  -- Stable key from the FEATURES catalog in src/lib/admin/feature-flags.ts.
  key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);

ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;
-- No policies: service-role only.
