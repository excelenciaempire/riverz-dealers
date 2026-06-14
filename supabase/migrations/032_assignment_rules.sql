-- ============================================================
-- 032: Reglas de asignación automática de conversaciones
-- ============================================================
--
-- Cuando llega un mensaje nuevo a una conversación SIN asignar, el
-- motor evalúa las reglas activas del workspace en orden de prioridad
-- y asigna al agente humano que corresponda.
--
-- Tipos de regla:
--   - round_robin: rota entre los agentes elegidos. Necesita estado
--     ("a quién le tocó la última") — lo guardamos en la fila mediante
--     `state` JSONB { last_assigned: uuid }.
--   - by_tag: si el contacto tiene tag X, asignar al agente Y.
--   - by_channel: si la conv viene del canal X, asignar al agente Y.
--   - by_keyword: si el primer mensaje contiene keyword, asignar al
--     agente Y.
--
-- Match para la conversación: la primera regla en `priority` ASC que
-- matchea, gana. Si ninguna matchea, la conv queda sin asignar (como
-- hoy).

CREATE TABLE IF NOT EXISTS conversation_assignment_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  priority INTEGER NOT NULL DEFAULT 100,
  kind TEXT NOT NULL CHECK (kind IN ('round_robin', 'by_tag', 'by_channel', 'by_keyword')),
  -- Configuración de la regla. Por kind:
  --   round_robin: { agent_ids: uuid[] }
  --   by_tag: { tag_id: uuid, agent_id: uuid }
  --   by_channel: { channel: text, agent_id: uuid }
  --   by_keyword: { keyword: text (case-insensitive), agent_id: uuid }
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Estado mutable para round_robin (last_assigned uuid). Otros tipos
  -- no lo usan.
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversation_assignment_rules_workspace_idx
  ON conversation_assignment_rules (workspace_id, is_active, priority);

ALTER TABLE conversation_assignment_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS car_select ON conversation_assignment_rules;
CREATE POLICY car_select ON conversation_assignment_rules
  FOR SELECT USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS car_modify ON conversation_assignment_rules;
CREATE POLICY car_modify ON conversation_assignment_rules
  FOR ALL USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid() AND role IN ('owner','admin')
    )
  );

COMMENT ON TABLE conversation_assignment_rules IS
  'Reglas de asignación automática. Migration 032.';
