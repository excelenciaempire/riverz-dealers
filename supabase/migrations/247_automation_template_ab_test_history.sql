-- `replaceSteps` deletes and reinserts automation_steps on each save. An A/B
-- result is historical evidence, so it must outlive its old step row. The
-- stable experiment_id retains the relationship to the replacement step.
ALTER TABLE automation_template_exposures
  DROP CONSTRAINT IF EXISTS automation_template_exposures_automation_step_id_fkey;

ALTER TABLE automation_template_exposures
  ALTER COLUMN automation_step_id DROP NOT NULL,
  ADD CONSTRAINT automation_template_exposures_automation_step_id_fkey
    FOREIGN KEY (automation_step_id) REFERENCES automation_steps(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ab_exposures_automation_experiment
  ON automation_template_exposures (workspace_id, automation_id, experiment_id, sent_at DESC);
