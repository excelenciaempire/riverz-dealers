-- ============================================================
-- 085 — Legal consent (Terms & Privacy) acceptance records
-- ============================================================
--
-- Makes the clickwrap agreement legally defensible. Riverz operates
-- under US governing law but serves users from any country (EU/UK
-- GDPR, California CCPA, LATAM, etc.), so we must keep a tamper-evident
-- record of WHO accepted, WHICH version of the documents, WHEN, and
-- from WHERE. Showing a checkbox is not enough on its own — the proof
-- of consent has to be stored server-side.
--
-- Two pieces:
--
--   1) public.legal_consents — append-only audit log. One row per
--      acceptance event (signup or invite acceptance). This is the
--      authoritative record. Users may read their own rows but cannot
--      INSERT/UPDATE/DELETE them (no write policy → only the service
--      role can write), so a user can't fabricate or erase consent.
--
--   2) profiles.terms_accepted_at / terms_version — convenience mirror
--      of the latest acceptance for quick "has this user accepted the
--      current version?" gating without scanning the audit log.
--
-- `version` is the ISO date of the legal docs in force at acceptance
-- time (see src/lib/legal/version.ts → LEGAL_VERSION). Bump it whenever
-- the substance of /terminos or /privacidad changes so future consent
-- rows point at the exact text agreed to, and so re-consent can be
-- required later if desired.
--
-- Idempotent. Apply via the Supabase Management API (manual — not run
-- on Render deploy).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.legal_consents (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Nullable + ON DELETE SET NULL so the consent record survives even
  -- if the auth user is later deleted (we still keep email for proof).
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  email       text NOT NULL,
  document    text NOT NULL DEFAULT 'terms_and_privacy',
  version     text NOT NULL,
  context     text NOT NULL,            -- 'signup' | 'invite'
  ip          text,
  user_agent  text,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS legal_consents_user_id_idx
  ON public.legal_consents (user_id);
CREATE INDEX IF NOT EXISTS legal_consents_email_idx
  ON public.legal_consents (lower(email));

ALTER TABLE public.legal_consents ENABLE ROW LEVEL SECURITY;

-- Read-only for the owner; no INSERT/UPDATE/DELETE policy exists, so
-- only the service role (which bypasses RLS) can write the audit log.
DROP POLICY IF EXISTS "Users can view own legal consents" ON public.legal_consents;
CREATE POLICY "Users can view own legal consents"
  ON public.legal_consents FOR SELECT
  USING (auth.uid() = user_id);

-- Latest-acceptance mirror on the profile for fast gating.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS terms_version     text;
