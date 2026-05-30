-- ============================================================
-- 023: Automations × segments
-- ============================================================
-- An automation can optionally be scoped to a saved contact segment.
-- When set, the engine only fires the automation for contacts that
-- currently match the segment definition (resolved at fire time, so
-- segment edits take effect immediately for future events).
--
-- ON DELETE SET NULL: deleting a segment quietly removes the filter
-- instead of cascading the deletion onto every automation that
-- references it — losing automations is worse than losing the scope.
--
-- The new 'in_segment' condition subject is JSONB-only (lives inside
-- step_config), so no schema change is needed for the condition step;
-- the engine reads { subject: 'in_segment', operand: '<segment_id>' }.

ALTER TABLE automations
  ADD COLUMN IF NOT EXISTS audience_segment_id UUID
  REFERENCES contact_segments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_automations_audience_segment
  ON automations(audience_segment_id)
  WHERE audience_segment_id IS NOT NULL;
