-- ============================================================
-- 116 — Per-member menu access (RBAC).
--
-- Adds `allowed_sections TEXT[]` to workspace_members (enforced) and
-- workspace_invites (pre-assigned by the inviter, copied on accept).
--
--   NULL           = full access — owners/admins and every legacy member.
--   '{}'           = no sections (only always-on ones like /ajustes).
--   '{"/bandeja"}' = restricted to those sidebar section keys (route prefixes).
--
-- The sidebar hides unauthorized items and a client guard redirects away from
-- them; workspace data stays RLS-scoped to membership as before. Idempotent.
-- ============================================================

ALTER TABLE workspace_members
  ADD COLUMN IF NOT EXISTS allowed_sections TEXT[];

ALTER TABLE workspace_invites
  ADD COLUMN IF NOT EXISTS allowed_sections TEXT[];
