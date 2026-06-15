-- ============================================================
-- 045 — Invite token email-match enforcement.
--
-- Background: the invite acceptance flow used to be link-bearer
-- (anyone with the token could claim the seat). The security audit
-- (wave 9 patch 3) requires the accepter to prove ownership of the
-- invited email address. This migration hardens the underlying
-- table so the API gate has the columns and indexes it needs.
--
-- Idempotent: safe to re-run.
-- ============================================================

-- Guarantee the columns the API expects. workspace_invites already
-- has these from 013_unified_inbox.sql but ADD COLUMN IF NOT EXISTS
-- makes us robust against partial-migration prod instances.
ALTER TABLE workspace_invites
  ADD COLUMN IF NOT EXISTS email TEXT;

ALTER TABLE workspace_invites
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '14 days');

ALTER TABLE workspace_invites
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;

-- Backfill any historical rows that pre-dated the email requirement
-- (none in prod, but defensive). Rows with NULL email are unusable
-- under the new gate, so mark them consumed.
UPDATE workspace_invites
   SET accepted_at = COALESCE(accepted_at, NOW())
 WHERE email IS NULL;

-- Now the column can be NOT NULL going forward.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'workspace_invites'
       AND column_name = 'email'
       AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE workspace_invites ALTER COLUMN email SET NOT NULL;
  END IF;
END $$;

-- Case-insensitive lookups: the API matches lower(invite.email) =
-- lower(user.email). Functional index keeps that O(log n).
CREATE INDEX IF NOT EXISTS idx_invites_email_lower
  ON workspace_invites (LOWER(email));
