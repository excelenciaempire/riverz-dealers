-- Sonnet is the baseline for agents and the platform voice pipeline.
-- Existing Haiku agents have no documented quality evaluation supporting an exception.
ALTER TABLE ai_agents ALTER COLUMN model SET DEFAULT 'claude-sonnet-5';

UPDATE ai_agents
SET model = 'claude-sonnet-5'
WHERE model LIKE 'claude-haiku-4-5%'
  AND deleted_at IS NULL;

ALTER TABLE voice_model_config ALTER COLUMN llm_model SET DEFAULT 'claude-sonnet-5';

UPDATE voice_model_config
SET llm_model = 'claude-sonnet-5'
WHERE llm_provider = 'anthropic'
  AND llm_model LIKE 'claude-haiku-4-5%';
