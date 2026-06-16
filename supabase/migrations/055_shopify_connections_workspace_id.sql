-- ============================================================
-- 055: shopify_connections.workspace_id NOT NULL
-- ============================================================
-- shopify_connections was originally a single-user table (user_id was
-- "the merchant"). Once workspaces landed in 029, we kept reading the
-- connection by `user_id` and resolving workspace via
-- `workspaces.owner_id = user_id` at every call site. That's:
--
--   * slow (extra round-trip per webhook + cron tick),
--   * non-deterministic for users that own multiple workspaces,
--   * and silently routes Shopify events to the wrong workspace
--     when the workspace owner changes.
--
-- This migration:
--
--   1. Adds workspace_id (UUID FK → workspaces.id, CASCADE).
--   2. Backfills every existing row from owner_id → workspaces.id.
--   3. Promotes it to NOT NULL.
--   4. Updates RLS to scope by workspace membership (matches the
--      rest of the schema) instead of by user_id.

ALTER TABLE shopify_connections
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;

-- Backfill: pick the oldest workspace owned by the connection's user_id.
-- Matches the legacy resolveWorkspaceIdForUser() heuristic so existing
-- rows keep routing to the same workspace they did before this change.
UPDATE shopify_connections sc
SET workspace_id = w.id
FROM workspaces w
WHERE sc.workspace_id IS NULL
  AND w.owner_id = sc.user_id
  AND w.id = (
    SELECT id FROM workspaces
    WHERE owner_id = sc.user_id
    ORDER BY created_at ASC
    LIMIT 1
  );

-- Safety net: if any row is still NULL after the backfill we'd rather
-- fail loud than silently apply NOT NULL and lose the connection. The
-- caller can inspect the rows and assign a workspace manually.
DO $$
DECLARE
  null_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO null_count
  FROM shopify_connections
  WHERE workspace_id IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION
      'Cannot apply NOT NULL on shopify_connections.workspace_id: % rows still have NULL workspace_id (no matching workspace owner_id)',
      null_count;
  END IF;
END $$;

ALTER TABLE shopify_connections
  ALTER COLUMN workspace_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shopify_connections_workspace_id
  ON shopify_connections(workspace_id);

-- RLS: scope by workspace membership, not by user_id. The old policies
-- assumed each merchant was their own tenant; with workspaces, any
-- workspace member should see the connection.
DROP POLICY IF EXISTS shopify_connections_select ON shopify_connections;
CREATE POLICY shopify_connections_select ON shopify_connections
  FOR SELECT USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS shopify_connections_modify ON shopify_connections;
CREATE POLICY shopify_connections_modify ON shopify_connections
  FOR ALL USING (is_workspace_member(workspace_id));
