-- ============================================================
-- 090 — Per-person Instagram profile enrichment.
--
-- Powers Blueberry-style 1:1 personalization: for a contact who MESSAGES the
-- business (the only population Meta's User Profile API is eligible for), we
-- store the sanctioned profile signals + a NON-SENSITIVE persona hint derived
-- from their profile picture. This is kept in a dedicated 1:1 table so the wide
-- `contacts` row stays clean, and so it degrades gracefully when absent.
--
-- Hard compliance line: NO feed/story photos of arbitrary users (no such API),
-- NO scraping, and the persona hint is interest cues only — never inferred
-- sensitive/protected attributes. We store the DERIVED hint, never the raw
-- profile_pic URL (it's a short-lived signed CDN URL).
-- ============================================================

CREATE TABLE IF NOT EXISTS contact_ig_profile (
  contact_id        UUID PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,

  -- Sanctioned Instagram User Profile API fields (only for DM senders).
  follower_count    INTEGER,
  is_verified       BOOLEAN,
  follows_business  BOOLEAN,       -- is_user_follow_business (owned-audience signal)
  business_follows  BOOLEAN,       -- is_business_follow_user

  -- Vision output over the profile picture: short, non-sensitive interest cues
  -- only (e.g. "tiene perro, estética outdoor"). NULL when nothing usable.
  persona_hint      TEXT,
  -- Hash of the profile-pic bytes, so we skip re-vision on an unchanged pic.
  pic_hash          TEXT,

  -- Whether Business Discovery found a PUBLIC pro account for them (opportunistic).
  bd_public_pro     BOOLEAN,

  enriched_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE contact_ig_profile ENABLE ROW LEVEL SECURITY;

-- Members of the contact's workspace can read the enrichment; writes happen via
-- the service role (the fire-and-forget ingest/enrich paths).
DROP POLICY IF EXISTS "Members read ig profile" ON contact_ig_profile;
CREATE POLICY "Members read ig profile" ON contact_ig_profile FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM contacts c
      WHERE c.id = contact_ig_profile.contact_id
        AND is_workspace_member(c.workspace_id)
    )
  );

DROP TRIGGER IF EXISTS set_updated_at ON contact_ig_profile;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON contact_ig_profile
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
