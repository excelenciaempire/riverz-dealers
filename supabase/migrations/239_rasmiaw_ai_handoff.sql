-- Una asignación a IA no es una asignación a una persona del equipo. Separarlas
-- evita que el motor pise `assigned_agent_id` y que un agente de recuperación
-- termine atendiendo conversaciones que no recibió del flujo.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS assigned_ai_agent_id UUID REFERENCES ai_agents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS automation_context JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_conversations_assigned_ai_agent
  ON conversations (assigned_ai_agent_id)
  WHERE assigned_ai_agent_id IS NOT NULL;

ALTER TABLE ai_agents
  ADD COLUMN IF NOT EXISTS assigned_only BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN ai_agents.assigned_only IS
  'Only answer conversations explicitly assigned through assigned_ai_agent_id.';
