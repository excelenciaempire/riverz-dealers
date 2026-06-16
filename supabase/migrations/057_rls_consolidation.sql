-- ============================================================
-- 057: RLS consolidation — uniform is_workspace_member() policies
-- ============================================================
-- Audits done in the prod-hardening pass (#16) surfaced four classes of
-- drift:
--
--   1. `shopify_products` was still user_id-scoped (mig 025) while
--      `shopify_connections` had moved to workspace_id (mig 055). The
--      AI runner had to resolve workspaces.owner_id → user_id at every
--      catalog read; webhooks routed to the install user even when the
--      workspace owner changed.
--
--   2. Several legacy "Users can manage own X" policies still tested
--      `auth.uid() = user_id` directly (contact_notes, flow_runs,
--      automation_logs, shopify_connections, shopify_products) or via
--      a parent join (broadcast_recipients, automation_steps,
--      flow_nodes, flow_run_events, contact_tags, contact_custom_values,
--      message_reactions). A second invited workspace member therefore
--      saw nothing on those tables even though they could read the
--      parent rows.
--
--   3. `flow_versions` and `conversation_assignment_rules` already
--      worked off workspace_members but spelled the membership check
--      inline instead of calling `is_workspace_member()`. Functionally
--      correct, but it bypasses the SECURITY DEFINER + STABLE helper
--      that the rest of the schema relies on for planner-friendly
--      policy folding.
--
--   4. `automation_logs` had BOTH policies live (workspace-member AND
--      user-scoped). Per Postgres RLS semantics that's OR-combined, so
--      the user_id branch was a privilege-escalation surface for users
--      who happened to own a row in a workspace they no longer belong
--      to. Dropping the user_id branch makes the table strictly
--      workspace-scoped.
--
-- This migration is idempotent end-to-end: it ADD COLUMN IF NOT EXISTS,
-- DROP POLICY IF EXISTS, and CREATE POLICY (which is allowed because
-- of the prior DROP). Re-runs against a partially-applied schema are
-- safe.

-- ------------------------------------------------------------
-- 1. shopify_products.workspace_id (NOT NULL + RLS realignment)
-- ------------------------------------------------------------
-- Mirrors the migration 055 treatment of shopify_connections: add the
-- column, backfill from the connection table (shop_domain is the
-- natural join key — every product was synced under a connection that
-- now has a workspace_id), enforce NOT NULL, swap the user_id policies
-- for workspace_member ones.

ALTER TABLE shopify_products
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;

-- Primary backfill: shop_domain → shopify_connections.workspace_id.
-- shop_domain is unique per connection (it's the merchant's myshopify
-- subdomain), so this is a deterministic 1:1 join.
UPDATE shopify_products sp
SET workspace_id = sc.workspace_id
FROM shopify_connections sc
WHERE sp.workspace_id IS NULL
  AND sc.shop_domain = sp.shop_domain
  AND sc.workspace_id IS NOT NULL;

-- Secondary backfill: if a product's connection was deleted but the
-- user still owns workspaces, route to their oldest workspace (matches
-- the migration 055 heuristic for stale connections).
UPDATE shopify_products sp
SET workspace_id = w.id
FROM workspaces w
WHERE sp.workspace_id IS NULL
  AND w.owner_id = sp.user_id
  AND w.id = (
    SELECT id FROM workspaces
    WHERE owner_id = sp.user_id
    ORDER BY created_at ASC
    LIMIT 1
  );

-- Safety net: if any row is still NULL after both backfills, fail loud
-- rather than silently apply NOT NULL and orphan the catalog. Caller
-- can inspect and assign manually.
DO $$
DECLARE
  null_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO null_count
  FROM shopify_products
  WHERE workspace_id IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION
      'Cannot apply NOT NULL on shopify_products.workspace_id: % rows still have NULL workspace_id (no matching shopify_connections row and no workspace owned by user_id)',
      null_count;
  END IF;
END $$;

ALTER TABLE shopify_products
  ALTER COLUMN workspace_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shopify_products_workspace_id
  ON shopify_products(workspace_id);

-- Old user_id-scoped policies → workspace_member.
DROP POLICY IF EXISTS "Owner reads own products" ON shopify_products;
DROP POLICY IF EXISTS "Owner writes own products" ON shopify_products;

CREATE POLICY shopify_products_select ON shopify_products
  FOR SELECT USING (is_workspace_member(workspace_id));

CREATE POLICY shopify_products_modify ON shopify_products
  FOR ALL USING (is_workspace_member(workspace_id))
  WITH CHECK (is_workspace_member(workspace_id));

-- ------------------------------------------------------------
-- 2. shopify_connections — drop the legacy user_id policy
-- ------------------------------------------------------------
-- Migration 055 added shopify_connections_select / _modify on top of
-- the old "Users can manage own shopify connections" policy. That left
-- the user_id branch live, which OR-combines back into the new policy
-- and lets a user who once owned the connection keep CRUD even after
-- the workspace transferred. Drop it.

DROP POLICY IF EXISTS "Users can manage own shopify connections" ON shopify_connections;

-- ------------------------------------------------------------
-- 3. automation_logs — strip the user_id duplicate
-- ------------------------------------------------------------
-- "Members can view workspace logs" already exists with the right
-- check. The legacy "Users can view own automation logs" OR-combines
-- and was an escalation surface (see preamble #4).

DROP POLICY IF EXISTS "Users can view own automation logs" ON automation_logs;

-- ------------------------------------------------------------
-- 4. contact_notes — switch from user_id to workspace_member
-- ------------------------------------------------------------
-- contact_notes already carries workspace_id (added in mig 029). The
-- table is shared workspace knowledge, not private to the author.

DROP POLICY IF EXISTS "Users can manage own notes" ON contact_notes;
CREATE POLICY contact_notes_select ON contact_notes
  FOR SELECT USING (is_workspace_member(workspace_id));
CREATE POLICY contact_notes_modify ON contact_notes
  FOR ALL USING (is_workspace_member(workspace_id))
  WITH CHECK (is_workspace_member(workspace_id));

-- ------------------------------------------------------------
-- 5. flow_runs — workspace_id-scoped (the column already exists)
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "Users see own flow runs" ON flow_runs;
CREATE POLICY flow_runs_select ON flow_runs
  FOR SELECT USING (is_workspace_member(workspace_id));

-- ------------------------------------------------------------
-- 6. flow_versions — replace inline workspace_members check with helper
-- ------------------------------------------------------------

DROP POLICY IF EXISTS flow_versions_select ON flow_versions;
DROP POLICY IF EXISTS flow_versions_insert ON flow_versions;
CREATE POLICY flow_versions_select ON flow_versions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM flows f
      WHERE f.id = flow_versions.flow_id
        AND is_workspace_member(f.workspace_id)
    )
  );
CREATE POLICY flow_versions_insert ON flow_versions
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM flows f
      WHERE f.id = flow_versions.flow_id
        AND is_workspace_member(f.workspace_id)
    )
  );

-- ------------------------------------------------------------
-- 7. conversation_assignment_rules — use helpers (was inline)
-- ------------------------------------------------------------

DROP POLICY IF EXISTS car_select ON conversation_assignment_rules;
DROP POLICY IF EXISTS car_modify ON conversation_assignment_rules;
CREATE POLICY car_select ON conversation_assignment_rules
  FOR SELECT USING (is_workspace_member(workspace_id));
CREATE POLICY car_modify ON conversation_assignment_rules
  FOR ALL USING (is_workspace_admin(workspace_id))
  WITH CHECK (is_workspace_admin(workspace_id));

-- ------------------------------------------------------------
-- 8. Child tables with user_id-via-parent policies
-- ------------------------------------------------------------
-- automation_steps → automations.workspace_id
-- broadcast_recipients → broadcasts.workspace_id
-- contact_custom_values → contacts.workspace_id
-- contact_tags → contacts.workspace_id
-- flow_nodes → flows.workspace_id
-- flow_run_events → flow_runs.workspace_id
-- message_reactions → conversations.workspace_id

DROP POLICY IF EXISTS "Users can manage steps of own automations" ON automation_steps;
CREATE POLICY automation_steps_all ON automation_steps
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM automations a
      WHERE a.id = automation_steps.automation_id
        AND is_workspace_member(a.workspace_id)
    )
  );

DROP POLICY IF EXISTS "Users can manage broadcast recipients" ON broadcast_recipients;
CREATE POLICY broadcast_recipients_all ON broadcast_recipients
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM broadcasts b
      WHERE b.id = broadcast_recipients.broadcast_id
        AND is_workspace_member(b.workspace_id)
    )
  );

DROP POLICY IF EXISTS "Users can manage custom values" ON contact_custom_values;
CREATE POLICY contact_custom_values_all ON contact_custom_values
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM contacts c
      WHERE c.id = contact_custom_values.contact_id
        AND is_workspace_member(c.workspace_id)
    )
  );

DROP POLICY IF EXISTS "Users can manage contact tags" ON contact_tags;
CREATE POLICY contact_tags_all ON contact_tags
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM contacts c
      WHERE c.id = contact_tags.contact_id
        AND is_workspace_member(c.workspace_id)
    )
  );

DROP POLICY IF EXISTS "Users manage nodes on their flows" ON flow_nodes;
CREATE POLICY flow_nodes_all ON flow_nodes
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM flows f
      WHERE f.id = flow_nodes.flow_id
        AND is_workspace_member(f.workspace_id)
    )
  );

DROP POLICY IF EXISTS "Users see events on their runs" ON flow_run_events;
CREATE POLICY flow_run_events_select ON flow_run_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM flow_runs r
      WHERE r.id = flow_run_events.flow_run_id
        AND is_workspace_member(r.workspace_id)
    )
  );

DROP POLICY IF EXISTS "Users see reactions on their conversations" ON message_reactions;
DROP POLICY IF EXISTS "Users insert reactions on their conversations" ON message_reactions;
DROP POLICY IF EXISTS "Users update their own agent reactions" ON message_reactions;
DROP POLICY IF EXISTS "Users delete their own agent reactions" ON message_reactions;
CREATE POLICY message_reactions_select ON message_reactions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = message_reactions.conversation_id
        AND is_workspace_member(c.workspace_id)
    )
  );
CREATE POLICY message_reactions_insert ON message_reactions
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = message_reactions.conversation_id
        AND is_workspace_member(c.workspace_id)
    )
  );
CREATE POLICY message_reactions_update ON message_reactions
  FOR UPDATE USING (
    actor_type = 'agent'
    AND actor_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = message_reactions.conversation_id
        AND is_workspace_member(c.workspace_id)
    )
  );
CREATE POLICY message_reactions_delete ON message_reactions
  FOR DELETE USING (
    actor_type = 'agent'
    AND actor_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = message_reactions.conversation_id
        AND is_workspace_member(c.workspace_id)
    )
  );

-- ------------------------------------------------------------
-- 9. automation_pending_executions — missing policies entirely
-- ------------------------------------------------------------
-- RLS is enabled but there are zero policies, so the table is invisible
-- to authenticated users (service role still bypasses, which is how
-- the worker reaches it today). Add workspace-scoped SELECT for the UI
-- and a service-role-only ALL deny so accidental anon paths can't
-- mutate it.

DROP POLICY IF EXISTS automation_pending_executions_select ON automation_pending_executions;
CREATE POLICY automation_pending_executions_select ON automation_pending_executions
  FOR SELECT USING (is_workspace_member(workspace_id));

-- ------------------------------------------------------------
-- 10. inbox_saved_filters — keep per-user but scope by workspace too
-- ------------------------------------------------------------
-- inbox_saved_filters is genuinely per-user state (each member's own
-- saved searches). Keeping user_id = auth.uid() is correct, but we
-- pair it with the workspace check so a user invited to multiple
-- workspaces sees a filter only inside the workspace it was created
-- under.

DROP POLICY IF EXISTS inbox_saved_filters_select ON inbox_saved_filters;
DROP POLICY IF EXISTS inbox_saved_filters_insert ON inbox_saved_filters;
DROP POLICY IF EXISTS inbox_saved_filters_update ON inbox_saved_filters;
DROP POLICY IF EXISTS inbox_saved_filters_delete ON inbox_saved_filters;
CREATE POLICY inbox_saved_filters_select ON inbox_saved_filters
  FOR SELECT USING (user_id = auth.uid() AND is_workspace_member(workspace_id));
CREATE POLICY inbox_saved_filters_insert ON inbox_saved_filters
  FOR INSERT WITH CHECK (user_id = auth.uid() AND is_workspace_member(workspace_id));
CREATE POLICY inbox_saved_filters_update ON inbox_saved_filters
  FOR UPDATE USING (user_id = auth.uid() AND is_workspace_member(workspace_id));
CREATE POLICY inbox_saved_filters_delete ON inbox_saved_filters
  FOR DELETE USING (user_id = auth.uid() AND is_workspace_member(workspace_id));

-- ------------------------------------------------------------
-- profiles — intentionally left alone
-- ------------------------------------------------------------
-- profiles is keyed on user_id (one row per auth user, no workspace
-- column). The "Users can [view|update|insert] own profile" policies
-- are correct: each user sees only their own profile, regardless of
-- workspace. Leaving them as-is.
