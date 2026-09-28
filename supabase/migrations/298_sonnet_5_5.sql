-- Sonnet 5.5 uses fewer tokens per task at the same list price, so every
-- Anthropic-backed commerce gets the lower effective cost immediately.
ALTER TABLE ai_agents ALTER COLUMN model SET DEFAULT 'claude-sonnet-5-5';

UPDATE ai_agents
SET model = 'claude-sonnet-5-5'
WHERE model LIKE 'claude%sonnet%'
  AND deleted_at IS NULL;

ALTER TABLE voice_model_config ALTER COLUMN llm_model SET DEFAULT 'claude-sonnet-5-5';

UPDATE voice_model_config
SET llm_model = 'claude-sonnet-5-5'
WHERE llm_provider = 'anthropic'
  AND llm_model LIKE 'claude%sonnet%';
