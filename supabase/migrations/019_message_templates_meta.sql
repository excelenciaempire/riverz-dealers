-- ============================================================
-- 019: Official Meta template submission metadata
-- ============================================================
-- The template builder now submits templates to Meta for approval
-- (POST /{waba-id}/message_templates) instead of only writing a local
-- Draft row. These columns let us correlate the local catalog row with
-- the Meta-side template and remember the variable example values + the
-- rejection reason Meta returns.

ALTER TABLE message_templates
  ADD COLUMN IF NOT EXISTS meta_template_id TEXT,
  ADD COLUMN IF NOT EXISTS variable_samples JSONB,
  ADD COLUMN IF NOT EXISTS rejected_reason TEXT;

-- Fast lookup when a status webhook / sync references the Meta id.
CREATE INDEX IF NOT EXISTS idx_message_templates_meta_id
  ON message_templates (meta_template_id);
