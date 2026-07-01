-- ============================================================
-- 091 — External Instagram enrichment (public-profile analysis).
--
-- Adds columns for enrichment sourced OUTSIDE the Meta Graph API — a
-- third-party scraper (Apify) that reads a PUBLIC account's bio + public post
-- captions + public photos to derive a rich, non-sensitive interest persona.
--
-- Architecture note: this runs on the third-party's infrastructure with our
-- OWN scraper credentials — it never touches the brand's Meta token/app, so the
-- brand's connected Instagram account is not the one doing the scraping. Public
-- accounts only; private accounts yield nothing (is_public = false). Opt-out is
-- honored before enrichment; the derived hint is non-sensitive interest cues
-- only (never protected attributes), same guardrail as the profile-pic path.
-- ============================================================

ALTER TABLE contact_ig_profile
  -- Rich interest persona derived from their PUBLIC bio + posts + photos.
  ADD COLUMN IF NOT EXISTS external_hint TEXT,
  -- Whether the account is public (scrapable) — false = private, nothing to do.
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN,
  ADD COLUMN IF NOT EXISTS external_enriched_at TIMESTAMPTZ;

-- The external enrich cron pulls IG contacts that still need it; index the sweep.
CREATE INDEX IF NOT EXISTS idx_contact_ig_profile_external
  ON contact_ig_profile (external_enriched_at);
