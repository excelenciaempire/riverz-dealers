-- ============================================================
-- 022: Contact segments (saved filter lists)
-- ============================================================
-- A segment is a named filter over the workspace's contacts. Rules are
-- stored as a JSONB array; each rule has the shape
--   { type: 'tag' | 'channel' | 'created' | 'has_field' | 'text' | 'custom_field',
--     op:   <operator string>,
--     ...payload }
-- (See src/lib/segments/types.ts for the full union.)
--
-- match_mode picks AND ("all") vs OR ("any") across the rule array.
--
-- Resolution lives in src/lib/segments/resolve.ts and runs in the
-- browser — fine for v1 (≤10k contacts per workspace). When that
-- breaks we can swap in a server-side resolver behind a route.

CREATE TABLE IF NOT EXISTS contact_segments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  match_mode TEXT NOT NULL DEFAULT 'all' CHECK (match_mode IN ('all', 'any')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_segments_workspace
  ON contact_segments(workspace_id);

-- keep updated_at honest
CREATE OR REPLACE FUNCTION touch_contact_segments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS contact_segments_touch ON contact_segments;
CREATE TRIGGER contact_segments_touch
  BEFORE UPDATE ON contact_segments
  FOR EACH ROW EXECUTE FUNCTION touch_contact_segments_updated_at();

ALTER TABLE contact_segments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can manage workspace segments" ON contact_segments;
CREATE POLICY "Members can manage workspace segments" ON contact_segments FOR ALL
  USING (is_workspace_member(workspace_id))
  WITH CHECK (is_workspace_member(workspace_id));
