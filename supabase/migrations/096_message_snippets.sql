-- ============================================================
-- 096: Message snippets (quick "/" canned replies)
-- ============================================================
-- Free-text canned replies a merchant inserts into the composer by typing
-- "/atajo". DISTINCT from message_templates (Meta HSM: approval-gated, {{n}}
-- variables, sent as templates outside the 24h window) — snippets are plain
-- text pasted into the chat within the window, editable, no approval.
--
--   shortcut  the "/atajo" trigger (unique per workspace, case-insensitive)
--   title     optional short label shown in the picker
--   body      the text inserted into the composer
--
-- Workspace-scoped, RLS by is_workspace_member. Applied MANUALLY via the
-- Supabase Management API query endpoint (not on Render deploy).
-- ============================================================

CREATE TABLE IF NOT EXISTS message_snippets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  shortcut TEXT NOT NULL,
  title TEXT,
  body TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_message_snippets_workspace
  ON message_snippets(workspace_id);
-- One "/shortcut" per workspace, case-insensitive.
CREATE UNIQUE INDEX IF NOT EXISTS uq_message_snippets_shortcut
  ON message_snippets(workspace_id, lower(shortcut));

CREATE OR REPLACE FUNCTION touch_message_snippets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS message_snippets_touch ON message_snippets;
CREATE TRIGGER message_snippets_touch
  BEFORE UPDATE ON message_snippets
  FOR EACH ROW EXECUTE FUNCTION touch_message_snippets_updated_at();

ALTER TABLE message_snippets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can manage workspace snippets" ON message_snippets;
CREATE POLICY "Members can manage workspace snippets" ON message_snippets FOR ALL
  USING (is_workspace_member(workspace_id))
  WITH CHECK (is_workspace_member(workspace_id));
