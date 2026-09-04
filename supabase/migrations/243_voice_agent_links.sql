-- Los agentes de chat no son agentes de voz. Cada uno puede vincular el
-- perfil telefónico que debe usar cuando una conversación necesita una llamada.
ALTER TABLE ai_agents
  ADD COLUMN IF NOT EXISTS voice_agent_id UUID
  REFERENCES ai_agents(id) ON DELETE SET NULL;

ALTER TABLE ai_agents
  DROP CONSTRAINT IF EXISTS ai_agents_voice_agent_not_self;

ALTER TABLE ai_agents
  ADD CONSTRAINT ai_agents_voice_agent_not_self
  CHECK (voice_agent_id IS NULL OR voice_agent_id <> id);

CREATE INDEX IF NOT EXISTS idx_ai_agents_voice_agent_id
  ON ai_agents(voice_agent_id)
  WHERE voice_agent_id IS NOT NULL;
