-- 015_drop_legacy_user_id_not_null.sql
--
-- Migration 013 added `workspace_id` to the legacy single-tenant
-- tables but left their original `user_id NOT NULL` columns in place.
-- That made the unified-inbox writers (which carry workspace_id, not
-- user_id) fail at insert time with:
--
--   null value in column "user_id" of relation "contacts"
--   violates not-null constraint (23502)
--
-- Drop NOT NULL from `user_id` everywhere the column still exists and
-- workspace_id is now the authoritative tenant key. The column itself
-- is kept (FKs into auth.users on legacy rows are still valid) so old
-- WhatsApp-only data and old per-user RLS policies remain intact.
--
-- Inverse migration: re-applying NOT NULL would fail on any row
-- written by the unified-inbox ingest, so this is one-way.

ALTER TABLE contacts          ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE conversations     ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE tags              ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE custom_fields     ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE message_templates ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE broadcasts        ALTER COLUMN user_id DROP NOT NULL;

-- `messages` doesn't have a user_id column directly (it inherits via
-- conversations) so no change there.
